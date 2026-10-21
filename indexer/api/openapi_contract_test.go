package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"clearledger/indexer/db"
	"clearledger/indexer/soroban"

	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/txnbuild"
	"github.com/stellar/go-stellar-sdk/xdr"
	"gopkg.in/yaml.v3"
)

// These tests are the executable half of the OpenAPI contract. Each one drives
// a real handler with representative inputs, then validates the status code,
// content type, required fields and field types against docs/openapi/indexer.yaml.
// A failure names the exact JSON path and the fix (handler or spec).

type openAPIDocument struct {
	Paths      map[string]map[string]openAPIOperation `yaml:"paths"`
	Components struct {
		Schemas   map[string]openAPISchema   `yaml:"schemas"`
		Responses map[string]openAPIResponse `yaml:"responses"`
	} `yaml:"components"`
}

type openAPIOperation struct {
	Responses map[string]openAPIResponse `yaml:"responses"`
}

type openAPIResponse struct {
	Description string                      `yaml:"description"`
	Content     map[string]openAPIMediaType `yaml:"content"`
}

type openAPIMediaType struct {
	Schema openAPISchema `yaml:"schema"`
}

type openAPISchema struct {
	Ref                  string                   `yaml:"$ref"`
	Type                 string                   `yaml:"type"`
	Format               string                   `yaml:"format"`
	Pattern              string                   `yaml:"pattern"`
	Nullable             bool                     `yaml:"nullable"`
	Enum                 []interface{}            `yaml:"enum"`
	Required             []string                 `yaml:"required"`
	Properties           map[string]openAPISchema `yaml:"properties"`
	Items                *openAPISchema           `yaml:"items"`
	AdditionalProperties interface{}              `yaml:"additionalProperties"`
}

func loadOpenAPIContract(t *testing.T) *openAPIDocument {
	t.Helper()
	specPath := filepath.Join("..", "..", "docs", "openapi", "indexer.yaml")
	raw, err := os.ReadFile(specPath)
	if err != nil {
		t.Fatalf("read OpenAPI spec %s: %v", specPath, err)
	}
	var spec openAPIDocument
	if err := yaml.Unmarshal(raw, &spec); err != nil {
		t.Fatalf("parse OpenAPI spec %s: %v", specPath, err)
	}
	return &spec
}

// assertResponseMatchesSpec checks the response against the operation/status
// documented in the spec. Prefixes every mismatch with the operation and status
// so failures point directly at the handler/spec pair that drifted.
func assertResponseMatchesSpec(t *testing.T, spec *openAPIDocument, method, specPath string, rr *httptest.ResponseRecorder) {
	t.Helper()
	label := method + " " + specPath
	operation, ok := spec.Paths[specPath][strings.ToLower(method)]
	if !ok {
		t.Fatalf("%s: operation is missing from the OpenAPI spec", label)
	}

	statusKey := strconv.Itoa(rr.Code)
	response, ok := operation.Responses[statusKey]
	if !ok {
		t.Errorf("%s: handler returned status %d, which is not documented; documented statuses: %s. Update docs/openapi/indexer.yaml or the handler.", label, rr.Code, strings.Join(sortedStringKeys(operation.Responses), ", "))
		return
	}

	if len(response.Content) == 0 {
		return
	}

	contentType := rr.Header().Get("Content-Type")
	mediaType := contentType
	if parsed, _, err := mime.ParseMediaType(contentType); err == nil {
		mediaType = parsed
	}
	media, ok := response.Content[mediaType]
	if !ok {
		t.Errorf("%s: status %d responded with Content-Type %q, which is not documented; documented content types: %s. Update docs/openapi/indexer.yaml or the handler.", label, rr.Code, contentType, strings.Join(sortedStringKeys(response.Content), ", "))
		return
	}

	if mediaType == "text/plain" {
		if strings.TrimSpace(rr.Body.String()) == "" {
			t.Errorf("%s: status %d returned an empty plain-text error body", label, rr.Code)
		}
		return
	}

	schema, name := spec.deref(media.Schema)
	schemaName := name
	if schemaName == "" {
		schemaName = schema.Type
	}
	for _, problem := range spec.validateJSON(schema, rr.Body.Bytes()) {
		t.Errorf("%s: status %d does not match schema %s: %s\nresponse body: %s", label, rr.Code, schemaName, problem, truncateForTest(rr.Body.String(), 600))
	}
}

func (s *openAPIDocument) validateJSON(schema openAPISchema, raw []byte) []string {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value interface{}
	if err := decoder.Decode(&value); err != nil {
		return []string{fmt.Sprintf("$: response is not valid JSON: %v", err)}
	}

	var problems []string
	s.validateValue(schema, value, "$", &problems)
	return problems
}

func (s *openAPIDocument) validateValue(schema openAPISchema, value interface{}, path string, problems *[]string) {
	schema, name := s.deref(schema)
	label := name
	if label == "" {
		label = schema.Type
	}
	if label == "" {
		label = "schema"
	}

	if value == nil {
		if schema.Nullable || schema.Type == "" {
			return
		}
		addContractProblem(problems, path, "expected %s, got null", label)
		return
	}

	switch schema.Type {
	case "", "object":
		if schema.Type == "" && len(schema.Properties) == 0 {
			return
		}
		object, ok := value.(map[string]interface{})
		if !ok {
			addContractProblem(problems, path, "expected object (%s), got %s", label, jsonTypeName(value))
			return
		}
		s.validateObject(schema, object, path, label, problems)
	case "array":
		items, ok := value.([]interface{})
		if !ok {
			addContractProblem(problems, path, "expected array, got %s", jsonTypeName(value))
			return
		}
		if schema.Items != nil {
			for i, item := range items {
				s.validateValue(*schema.Items, item, fmt.Sprintf("%s[%d]", path, i), problems)
			}
		}
	case "string":
		text, ok := value.(string)
		if !ok {
			addContractProblem(problems, path, "expected string, got %s", jsonTypeName(value))
			return
		}
		if schema.Format == "date-time" {
			if _, err := time.Parse(time.RFC3339, text); err != nil {
				addContractProblem(problems, path, "expected RFC 3339 date-time, got %q", text)
			}
		}
		if schema.Pattern != "" {
			pattern, err := regexp.Compile(schema.Pattern)
			if err == nil && !pattern.MatchString(text) {
				addContractProblem(problems, path, "value %q does not match pattern %q", text, schema.Pattern)
			}
		}
		validateStringEnum(schema.Enum, text, path, problems)
	case "integer":
		number, ok := value.(json.Number)
		if !ok {
			addContractProblem(problems, path, "expected integer, got %s", jsonTypeName(value))
			return
		}
		if strings.ContainsAny(number.String(), ".eE") {
			addContractProblem(problems, path, "expected integer, got non-integral number %s", number.String())
			return
		}
		if _, err := strconv.ParseInt(number.String(), 10, 64); err != nil {
			addContractProblem(problems, path, "expected an integer representable as int64, got %s", number.String())
		}
	case "number":
		if _, ok := value.(json.Number); !ok {
			addContractProblem(problems, path, "expected number, got %s", jsonTypeName(value))
		}
	case "boolean":
		if _, ok := value.(bool); !ok {
			addContractProblem(problems, path, "expected boolean, got %s", jsonTypeName(value))
		}
	}
}

func (s *openAPIDocument) validateObject(schema openAPISchema, object map[string]interface{}, path, label string, problems *[]string) {
	for _, required := range schema.Required {
		if _, ok := object[required]; !ok {
			addContractProblem(problems, path, "missing required property %q for %s", required, label)
		}
	}

	documented := sortedStringKeys(schema.Properties)
	for key, value := range object {
		if property, ok := schema.Properties[key]; ok {
			s.validateValue(property, value, path+"."+key, problems)
			continue
		}
		if allowsAdditionalProperties(schema.AdditionalProperties) {
			continue
		}
		addContractProblem(problems, path+"."+key, "property %q is not documented in %s; documented properties: %s. Update docs/openapi/indexer.yaml or the handler.", key, label, strings.Join(documented, ", "))
	}
}

func (s *openAPIDocument) deref(schema openAPISchema) (openAPISchema, string) {
	const prefix = "#/components/schemas/"
	name := ""
	seen := make(map[string]bool)
	for schema.Ref != "" {
		if seen[schema.Ref] || !strings.HasPrefix(schema.Ref, prefix) {
			break
		}
		seen[schema.Ref] = true
		referenced, ok := s.Components.Schemas[strings.TrimPrefix(schema.Ref, prefix)]
		if !ok {
			break
		}
		name = strings.TrimPrefix(schema.Ref, prefix)
		schema = referenced
	}
	return schema, name
}

func allowsAdditionalProperties(value interface{}) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case map[string]interface{}:
		return true
	default:
		return false
	}
}

func validateStringEnum(enum []interface{}, value, path string, problems *[]string) {
	if len(enum) == 0 {
		return
	}
	for _, allowed := range enum {
		if fmt.Sprint(allowed) == value {
			return
		}
	}
	values := make([]string, 0, len(enum))
	for _, allowed := range enum {
		values = append(values, fmt.Sprint(allowed))
	}
	addContractProblem(problems, path, "value %q is not one of the documented enum values: %s", value, strings.Join(values, ", "))
}

func addContractProblem(problems *[]string, path, format string, args ...interface{}) {
	*problems = append(*problems, path+": "+fmt.Sprintf(format, args...))
}

func jsonTypeName(value interface{}) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case map[string]interface{}:
		return "object"
	case []interface{}:
		return "array"
	case string:
		return "string"
	case bool:
		return "boolean"
	case json.Number:
		if strings.ContainsAny(typed.String(), ".eE") {
			return "number"
		}
		return "integer"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func sortedStringKeys[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func truncateForTest(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max] + "..."
}

// ------------------------------------------------------------------
// Invoice contract
// ------------------------------------------------------------------

func representativeInvoice() *db.DbInvoice {
	fundedAt := int64(1747000000)
	shippedAt := int64(1747100000)
	buyerConfirmedAt := int64(1747200000)
	repaidAt := int64(1748000000)
	agentID := "agent-demo"
	riskScore := 4200
	evidenceHash := "sha256:0123456789abcdef"
	attestedAt := int64(1747050000)

	return &db.DbInvoice{
		ID:                 strings.Repeat("ab", 32),
		Issuer:             "GISSUERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		Buyer:              "GBUYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		FaceValue:          "10000000000",
		DiscountBps:        250,
		FundedAmount:       "9750000000",
		DueDate:            1790000000,
		Status:             "Funded",
		CreatedAt:          1746900000,
		FundedAt:           &fundedAt,
		ShippedAt:          &shippedAt,
		IssuerConfirmed:    true,
		BuyerConfirmed:     true,
		BuyerConfirmedAt:   &buyerConfirmedAt,
		RepaidAt:           &repaidAt,
		AttestationAgentID: &agentID,
		RiskScoreBps:       &riskScore,
		EvidenceHash:       &evidenceHash,
		AttestedAt:         &attestedAt,
	}
}

func TestOpenAPIInvoiceResponsesMatchSpec(t *testing.T) {
	spec := loadOpenAPIContract(t)
	invoice := representativeInvoice()

	t.Run("GET /invoices success", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getInvoicesPageFn = func(_ context.Context, status, issuer, buyer string, dueDate *int64, limit, offset int, cursor *db.InvoiceCursor) ([]*db.DbInvoice, int, bool, error) {
			if limit != 20 || offset != 0 {
				t.Errorf("expected default pagination limit=20 offset=0, got limit=%d offset=%d", limit, offset)
			}
			return []*db.DbInvoice{invoice}, 1, false, nil
		}

		rr := httptest.NewRecorder()
		h.HandleGetInvoices(rr, httptest.NewRequest(http.MethodGet, "/invoices", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/invoices", rr)
	})

	t.Run("GET /invoices/{id} success", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getInvoiceByIDFn = func(_ context.Context, id string) (*db.DbInvoice, error) {
			if id != invoice.ID {
				t.Errorf("expected id %q to be forwarded, got %q", invoice.ID, id)
			}
			return invoice, nil
		}

		req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/"+invoice.ID, nil), map[string]string{"id": invoice.ID})
		rr := httptest.NewRecorder()
		h.HandleGetInvoiceByID(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/invoices/{id}", rr)
	})

	t.Run("GET /invoices/{id} not found", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getInvoiceByIDFn = func(_ context.Context, _ string) (*db.DbInvoice, error) {
			return nil, nil
		}

		req := withURLParams(httptest.NewRequest(http.MethodGet, "/invoices/missing", nil), map[string]string{"id": "missing"})
		rr := httptest.NewRecorder()
		h.HandleGetInvoiceByID(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/invoices/{id}", rr)
	})

	t.Run("POST /invoices success", func(t *testing.T) {
		h := newInvoiceContractHandler(t)
		issuer, buyer := randomKeypairAddress(t), randomKeypairAddress(t)

		rr := invoiceRequest(t, h, issuer, buyer, "1000", time.Now().Add(24*time.Hour).Unix())
		assertResponseMatchesSpec(t, spec, http.MethodPost, "/invoices", rr)
	})

	t.Run("POST /invoices bad request", func(t *testing.T) {
		h := newInvoiceContractHandler(t)
		issuer, buyer := randomKeypairAddress(t), randomKeypairAddress(t)

		rr := invoiceRequest(t, h, issuer, buyer, "0", time.Now().Add(24*time.Hour).Unix())
		assertResponseMatchesSpec(t, spec, http.MethodPost, "/invoices", rr)
	})

	t.Run("POST /invoices unauthorized", func(t *testing.T) {
		h := newInvoiceContractHandler(t)
		_, buyer := randomKeypairAddress(t), randomKeypairAddress(t)

		rr := invoiceRequest(t, h, "", buyer, "1000", time.Now().Add(24*time.Hour).Unix())
		assertResponseMatchesSpec(t, spec, http.MethodPost, "/invoices", rr)
	})
}

func newInvoiceContractHandler(t *testing.T) *APIHandler {
	t.Helper()
	h := readonlyTestHandler(t)
	h.cfg.InvoiceContractID = "CAKEWH7SJCXGV2MH2WZYIX3QDPTSSBQFXYVYBOWAGLNBBZMPLE2US6CS"

	invoiceID := []byte(strings.Repeat("i", 32))
	invoiceIDValue := xdr.ScBytes(invoiceID)
	invoiceIDScVal := xdr.ScVal{Type: xdr.ScValTypeScvBytes, Bytes: &invoiceIDValue}
	invoiceIDXDR, err := invoiceIDScVal.MarshalBinary()
	if err != nil {
		t.Fatalf("marshal invoice id: %v", err)
	}
	transactionData, err := (xdr.SorobanTransactionData{}).MarshalBinary()
	if err != nil {
		t.Fatalf("marshal transaction data: %v", err)
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request soroban.JsonRpcRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		var response string
		switch request.Method {
		case "getAccount":
			response = `{"jsonrpc":"2.0","id":1,"result":{"id":"` + h.serverKP.Address() + `","sequence":"1"}}`
		case "simulateTransaction":
			response = `{"jsonrpc":"2.0","id":1,"result":{"transactionData":"` + base64.StdEncoding.EncodeToString(transactionData) + `","minResourceFee":"100","results":[{"xdr":"` + base64.StdEncoding.EncodeToString(invoiceIDXDR) + `"}]}}`
		case "sendTransaction":
			response = `{"jsonrpc":"2.0","id":1,"result":{"hash":"test-hash","status":"PENDING"}}`
		case "getTransaction":
			response = `{"jsonrpc":"2.0","id":1,"result":{"status":"SUCCESS","hash":"test-hash"}}`
		default:
			response = `{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"method not found"}}`
		}
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	h.cfg.SorobanRPCURL = server.URL
	return h
}

func randomKeypairAddress(t *testing.T) string {
	t.Helper()
	kp, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate keypair: %v", err)
	}
	return kp.Address()
}

// ------------------------------------------------------------------
// Pool contract
// ------------------------------------------------------------------

func TestOpenAPIPoolResponsesMatchSpec(t *testing.T) {
	spec := loadOpenAPIContract(t)

	t.Run("GET /pool/stats success", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getPoolStatsFn = func(_ context.Context) (*db.DbPoolStats, error) {
			return &db.DbPoolStats{
				TotalDeposits:         "10000000000",
				TotalFunded:           "7500000000",
				AvailableLiquidity:    "2500000000",
				UtilizationRateBps:    7500,
				TotalYieldDistributed: "150000",
				ActiveInvoiceCount:    3,
				TotalShares:           "10000000000",
				UpdatedAt:             time.Date(2025, 8, 20, 12, 0, 0, 0, time.UTC),
			}, nil
		}

		rr := httptest.NewRecorder()
		h.HandleGetPoolStats(rr, httptest.NewRequest(http.MethodGet, "/pool/stats", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/stats", rr)
	})

	t.Run("GET /pool/stats internal error", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getPoolStatsFn = func(_ context.Context) (*db.DbPoolStats, error) {
			return nil, fmt.Errorf("database unavailable")
		}

		rr := httptest.NewRecorder()
		h.HandleGetPoolStats(rr, httptest.NewRequest(http.MethodGet, "/pool/stats", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/stats", rr)
	})

	t.Run("GET /pool/snapshots success", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getPoolSnapshotsFn = func(_ context.Context, limit int) ([]*db.DbPoolSnapshotHistory, error) {
			if limit != 100 {
				t.Errorf("expected default limit=100, got %d", limit)
			}
			return []*db.DbPoolSnapshotHistory{
				{
					RecordedAt:            1748000000,
					TotalDeposits:         "10000000000",
					TotalFunded:           "7500000000",
					AvailableLiquidity:    "2500000000",
					UtilizationRateBps:    7500,
					TotalYieldDistributed: "150000",
					ActiveInvoiceCount:    3,
					TotalShares:           "10000000000",
				},
			}, nil
		}

		rr := httptest.NewRecorder()
		h.HandleGetPoolSnapshots(rr, httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/snapshots", rr)
	})

	t.Run("GET /pool/snapshots internal error", func(t *testing.T) {
		h := readonlyTestHandler(t)
		h.getPoolSnapshotsFn = func(_ context.Context, _ int) ([]*db.DbPoolSnapshotHistory, error) {
			return nil, fmt.Errorf("database unavailable")
		}

		rr := httptest.NewRecorder()
		h.HandleGetPoolSnapshots(rr, httptest.NewRequest(http.MethodGet, "/pool/snapshots", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/snapshots", rr)
	})

	t.Run("GET /pool/position/{address} success", func(t *testing.T) {
		h := readonlyTestHandler(t)
		address := randomKeypairAddress(t)
		h.readContractFn = func(_ context.Context, _ string, _ string, method string, args []xdr.ScVal, _ *keypair.Full) (xdr.ScVal, error) {
			if method != "get_lp_position" {
				t.Errorf("expected get_lp_position, got %q", method)
			}
			if len(args) != 1 {
				t.Errorf("expected one address argument, got %d", len(args))
			}
			return buildLPPositionScVal(7, 1234, 5678, 90), nil
		}

		req := withURLParams(httptest.NewRequest(http.MethodGet, "/pool/position/"+address, nil), map[string]string{"address": address})
		rr := httptest.NewRecorder()
		h.HandleGetLPPosition(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/position/{address}", rr)
	})

	t.Run("GET /pool/position/{address} invalid address", func(t *testing.T) {
		h := readonlyTestHandler(t)

		req := withURLParams(httptest.NewRequest(http.MethodGet, "/pool/position/not-a-stellar-address", nil), map[string]string{"address": "not-a-stellar-address"})
		rr := httptest.NewRecorder()
		h.HandleGetLPPosition(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/position/{address}", rr)
	})

	t.Run("GET /pool/position/{address} internal error", func(t *testing.T) {
		h := readonlyTestHandler(t)
		address := randomKeypairAddress(t)
		h.readContractFn = func(_ context.Context, _ string, _ string, _ string, _ []xdr.ScVal, _ *keypair.Full) (xdr.ScVal, error) {
			return xdr.ScVal{}, fmt.Errorf("rpc unavailable")
		}

		req := withURLParams(httptest.NewRequest(http.MethodGet, "/pool/position/"+address, nil), map[string]string{"address": address})
		rr := httptest.NewRecorder()
		h.HandleGetLPPosition(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/pool/position/{address}", rr)
	})
}

// ------------------------------------------------------------------
// Auth contract
// ------------------------------------------------------------------

func TestOpenAPIAuthResponsesMatchSpec(t *testing.T) {
	spec := loadOpenAPIContract(t)
	client, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate client keypair: %v", err)
	}

	t.Run("GET /auth success", func(t *testing.T) {
		h := newTestHandler(t)

		rr := httptest.NewRecorder()
		h.HandleGetAuth(rr, httptest.NewRequest(http.MethodGet, "/auth?address="+client.Address(), nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/auth", rr)
	})

	t.Run("GET /auth invalid address", func(t *testing.T) {
		h := newTestHandler(t)

		rr := httptest.NewRecorder()
		h.HandleGetAuth(rr, httptest.NewRequest(http.MethodGet, "/auth?address=not-a-stellar-address", nil))
		assertResponseMatchesSpec(t, spec, http.MethodGet, "/auth", rr)
	})

	t.Run("POST /auth success", func(t *testing.T) {
		h := newTestHandler(t)

		challengeRecorder := httptest.NewRecorder()
		h.HandleGetAuth(challengeRecorder, httptest.NewRequest(http.MethodGet, "/auth?address="+client.Address(), nil))
		if challengeRecorder.Code != http.StatusOK {
			t.Fatalf("create challenge: got status %d; body: %s", challengeRecorder.Code, challengeRecorder.Body.String())
		}
		var challenge struct {
			Transaction string `json:"transaction"`
		}
		if err := json.Unmarshal(challengeRecorder.Body.Bytes(), &challenge); err != nil {
			t.Fatalf("decode challenge: %v", err)
		}

		genericTx, err := txnbuild.TransactionFromXDR(challenge.Transaction)
		if err != nil {
			t.Fatalf("parse challenge transaction: %v", err)
		}
		tx, ok := genericTx.Transaction()
		if !ok {
			t.Fatal("challenge is not a transaction")
		}
		tx, err = tx.Sign(testNetworkPassphrase, client)
		if err != nil {
			t.Fatalf("sign challenge: %v", err)
		}
		signed, err := tx.Base64()
		if err != nil {
			t.Fatalf("encode signed challenge: %v", err)
		}

		body, err := json.Marshal(map[string]string{"transaction": signed})
		if err != nil {
			t.Fatalf("marshal auth request: %v", err)
		}
		req := httptest.NewRequest(http.MethodPost, "/auth", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.HandlePostAuth(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodPost, "/auth", rr)
	})

	t.Run("POST /auth bad request", func(t *testing.T) {
		h := newTestHandler(t)

		req := httptest.NewRequest(http.MethodPost, "/auth", strings.NewReader(`{"other":"value"}`))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		h.HandlePostAuth(rr, req)
		assertResponseMatchesSpec(t, spec, http.MethodPost, "/auth", rr)
	})
}
