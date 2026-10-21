package api

import (
	"context"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/strkey"
)

// testContractAddress returns a valid 32-byte contract (C...) StrKey.
func testContractAddress(t *testing.T) string {
	t.Helper()

	address, err := strkey.Encode(strkey.VersionByteContract, make([]byte, 32))
	if err != nil {
		t.Fatalf("encode contract address: %v", err)
	}
	return address
}

// corruptStrkeyChecksum changes the final base32 character so the StrKey
// decodes structurally but fails checksum validation.
func corruptStrkeyChecksum(address string) string {
	replacement := byte('A')
	if address[len(address)-1] == replacement {
		replacement = 'B'
	}
	return address[:len(address)-1] + string(replacement)
}

// futureDueDate returns a due date comfortably inside the accepted window
// (tomorrow), since validation rejects timestamps in the past.
func futureDueDate() int64 {
	return time.Now().Add(24 * time.Hour).Unix()
}

// TestValidateCreateInvoiceRequest exercises the extracted request-validation
// step of HandleCreateInvoice directly, with no Soroban RPC or signing
// pipeline in play (Issue #674).
func TestValidateCreateInvoiceRequest(t *testing.T) {
	issuer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate issuer keypair: %v", err)
	}
	buyer, err := keypair.Random()
	if err != nil {
		t.Fatalf("generate buyer keypair: %v", err)
	}

	validBody := createInvoiceRequest{
		Buyer:     buyer.Address(),
		FaceValue: "1000",
		DueDate:   futureDueDate(),
	}

	tests := []struct {
		name       string
		issuer     string
		withIssuer bool
		body       createInvoiceRequest
		wantStatus int
		wantMsg    string
	}{
		{
			name:       "missing authentication context",
			body:       validBody,
			wantStatus: http.StatusUnauthorized,
			wantMsg:    "Unauthorized: user address missing from context",
		},
		{
			name:       "empty issuer in context",
			issuer:     "",
			withIssuer: true,
			body:       validBody,
			wantStatus: http.StatusUnauthorized,
			wantMsg:    "Unauthorized: user address missing from context",
		},
		{
			name:       "malformed issuer in context",
			issuer:     "not-a-stellar-address",
			withIssuer: true,
			body:       validBody,
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid issuer address: malformed Stellar StrKey",
		},
		{
			name:       "contract issuer in context",
			issuer:     testContractAddress(t),
			withIssuer: true,
			body:       validBody,
			wantStatus: http.StatusUnprocessableEntity,
			wantMsg:    "invalid issuer address: expected a Stellar account address (G...)",
		},
		{
			name:       "missing buyer",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: "", FaceValue: "1000", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid buyer address: value is required",
		},
		{
			name:       "missing face value",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "missing required invoice parameters",
		},
		{
			name:       "non-positive due date",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "1000", DueDate: 0},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "missing required invoice parameters",
		},
		{
			name:       "malformed buyer address",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: "not-a-stellar-address", FaceValue: "1000", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid buyer address: malformed Stellar StrKey",
		},
		{
			name:       "buyer bad checksum",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: corruptStrkeyChecksum(buyer.Address()), FaceValue: "1000", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid buyer address: malformed Stellar StrKey",
		},
		{
			name:       "contract buyer in account field",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: testContractAddress(t), FaceValue: "1000", DueDate: futureDueDate()},
			wantStatus: http.StatusUnprocessableEntity,
			wantMsg:    "invalid buyer address: expected a Stellar account address (G...)",
		},
		{
			name:       "buyer seed in public-key field",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Seed(), FaceValue: "1000", DueDate: futureDueDate()},
			wantStatus: http.StatusUnprocessableEntity,
			wantMsg:    "invalid buyer address: expected a Stellar account address (G...)",
		},
		{
			name:       "zero face value",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "0", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value",
		},
		{
			name:       "negative face value",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "-5", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value",
		},
		{
			name:       "non-numeric face value",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "abc", DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value",
		},
		{
			name:       "face value above u128 range",
			issuer:     issuer.Address(),
			withIssuer: true,
			// 2^128 would wrap to 0 in a u128; reject before the server pays
			// to simulate and submit.
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: new(big.Int).Lsh(big.NewInt(1), 128).String(), DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value: face_value exceeds the u128 range (max 2^128 - 1)",
		},
		{
			name:       "face value far above u128 range",
			issuer:     issuer.Address(),
			withIssuer: true,
			// 2^128 + 5 would silently truncate to 5 on-chain without the bound.
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: new(big.Int).Add(new(big.Int).Lsh(big.NewInt(1), 128), big.NewInt(5)).String(), DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value: face_value exceeds the u128 range (max 2^128 - 1)",
		},
		{
			name:       "face value longer than max digits",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: strings.Repeat("9", maxFaceValueDigits+1), DueDate: futureDueDate()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid face value: face_value exceeds the u128 range (max 2^128 - 1)",
		},
		{
			name:       "due date in the past",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "1000", DueDate: time.Now().Add(-24 * time.Hour).Unix()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid due date: due_date must be a future Unix timestamp",
		},
		{
			name:       "due date beyond maximum horizon",
			issuer:     issuer.Address(),
			withIssuer: true,
			body:       createInvoiceRequest{Buyer: buyer.Address(), FaceValue: "1000", DueDate: time.Now().Add(time.Duration(maxDueDateHorizonSeconds)*time.Second + 24*time.Hour).Unix()},
			wantStatus: http.StatusBadRequest,
			wantMsg:    "invalid due date: due_date exceeds the maximum horizon of 1825 days from now",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			if tt.withIssuer {
				ctx = WithUserAddress(ctx, tt.issuer)
			}

			params, err := validateCreateInvoiceRequest(ctx, tt.body)
			if err == nil {
				t.Fatalf("expected validation to fail, got params %+v", params)
			}
			if params != nil {
				t.Errorf("expected nil params on failure, got %+v", params)
			}

			var he *httpError
			if !errors.As(err, &he) {
				t.Fatalf("expected *httpError, got %T (%v)", err, err)
			}
			if he.Status() != tt.wantStatus {
				t.Errorf("status: got %d, want %d", he.Status(), tt.wantStatus)
			}
			if he.Error() != tt.wantMsg {
				t.Errorf("message: got %q, want %q", he.Error(), tt.wantMsg)
			}
		})
	}
}

func TestValidateCreateInvoiceRequest_ValidRequestReturnsParams(t *testing.T) {
	issuer, _ := keypair.Random()
	buyer, _ := keypair.Random()

	ctx := WithUserAddress(context.Background(), issuer.Address())
	// A face value beyond 2^64 confirms the value survives as a big.Int rather
	// than being truncated during validation, while staying inside the u128
	// ceiling the contract accepts.
	largeFaceValue := new(big.Int).Lsh(big.NewInt(1), 70)
	dueDate := futureDueDate()

	params, err := validateCreateInvoiceRequest(ctx, createInvoiceRequest{
		Buyer:     buyer.Address(),
		FaceValue: largeFaceValue.String(),
		DueDate:   dueDate,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if params.Issuer != issuer.Address() {
		t.Errorf("issuer: got %q, want %q", params.Issuer, issuer.Address())
	}
	if params.Buyer != buyer.Address() {
		t.Errorf("buyer: got %q, want %q", params.Buyer, buyer.Address())
	}
	if params.FaceValue.Cmp(largeFaceValue) != 0 {
		t.Errorf("face value: got %s, want %s", params.FaceValue, largeFaceValue)
	}
	if params.DueDate != uint64(dueDate) {
		t.Errorf("due date: got %d, want %d", params.DueDate, dueDate)
	}
}

// TestValidateCreateInvoiceRequest_FaceValueBoundaries pins the u128 ceiling:
// 2^128 - 1 is the largest value the contract can represent and must pass.
func TestValidateCreateInvoiceRequest_FaceValueBoundaries(t *testing.T) {
	issuer, _ := keypair.Random()
	buyer, _ := keypair.Random()
	ctx := WithUserAddress(context.Background(), issuer.Address())

	maxU128 := new(big.Int).Sub(new(big.Int).Lsh(big.NewInt(1), 128), big.NewInt(1))
	params, err := validateCreateInvoiceRequest(ctx, createInvoiceRequest{
		Buyer:     buyer.Address(),
		FaceValue: maxU128.String(),
		DueDate:   futureDueDate(),
	})
	if err != nil {
		t.Fatalf("expected 2^128 - 1 to be accepted, got error: %v", err)
	}
	if params.FaceValue.Cmp(maxU128) != 0 {
		t.Errorf("face value: got %s, want %s", params.FaceValue, maxU128)
	}
}

// TestValidateCreateInvoiceRequest_DueDateBoundaries pins the accepted due-date
// window: strictly future, and no further than maxDueDateHorizonSeconds out.
func TestValidateCreateInvoiceRequest_DueDateBoundaries(t *testing.T) {
	issuer, _ := keypair.Random()
	buyer, _ := keypair.Random()
	ctx := WithUserAddress(context.Background(), issuer.Address())

	// Just inside the horizon is accepted.
	nearHorizon := time.Now().Add(time.Duration(maxDueDateHorizonSeconds)*time.Second - time.Hour).Unix()
	params, err := validateCreateInvoiceRequest(ctx, createInvoiceRequest{
		Buyer:     buyer.Address(),
		FaceValue: "1000",
		DueDate:   nearHorizon,
	})
	if err != nil {
		t.Fatalf("expected due date just inside the horizon to be accepted, got error: %v", err)
	}
	if params.DueDate != uint64(nearHorizon) {
		t.Errorf("due date: got %d, want %d", params.DueDate, nearHorizon)
	}

	// One second in the past is rejected.
	if _, err := validateCreateInvoiceRequest(ctx, createInvoiceRequest{
		Buyer:     buyer.Address(),
		FaceValue: "1000",
		DueDate:   time.Now().Unix() - 1,
	}); err == nil {
		t.Fatal("expected past due date to be rejected")
	}
}
