package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"clearledger/indexer/db"
)

func TestHandleGetInvoicesFiltersAndCursor(t *testing.T) {
	h := newTestHandler(t)
	dueDate := int64(1_800_000_000)
	first := &db.DbInvoice{ID: "invoice-1", CreatedAt: 20}
	second := &db.DbInvoice{ID: "invoice-2", CreatedAt: 10}
	called := 0
	h.getInvoicesPageFn = func(_ context.Context, status, issuer, buyer string, due *int64, limit, offset int, cursor *db.InvoiceCursor) ([]*db.DbInvoice, int, bool, error) {
		called++
		if status != "Created" || issuer != "issuer" || buyer != "buyer" || due == nil || *due != dueDate || limit != 2 {
			t.Errorf("unexpected filter args status=%q issuer=%q buyer=%q due=%v limit=%d", status, issuer, buyer, due, limit)
		}
		if called == 1 && (offset != 0 || cursor != nil) {
			t.Errorf("first page offset=%d cursor=%v", offset, cursor)
		}
		if called == 2 && (offset != 0 || cursor == nil || cursor.ID != first.ID || cursor.CreatedAt != first.CreatedAt) {
			t.Errorf("cursor page offset=%d cursor=%+v", offset, cursor)
		}
		return []*db.DbInvoice{second, first}, 3, true, nil
	}

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/invoices?status=Created&issuer=issuer&buyer=buyer&due_date=1800000000&limit=2", nil)
	h.HandleGetInvoices(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("first page status=%d body=%s", rr.Code, rr.Body.String())
	}
	var response struct {
		NextCursor string `json:"next_cursor"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode first page: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(response.NextCursor)
	if err != nil {
		t.Fatalf("decode next_cursor: %v", err)
	}
	var next db.InvoiceCursor
	if err := json.Unmarshal(decoded, &next); err != nil {
		t.Fatalf("decode cursor payload: %v", err)
	}
	if next.ID != first.ID || next.CreatedAt != first.CreatedAt {
		t.Fatalf("next cursor=%+v, want last returned invoice %+v", next, first)
	}

	rr = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/invoices?status=Created&issuer=issuer&buyer=buyer&due_date=1800000000&limit=2&cursor="+response.NextCursor, nil)
	h.HandleGetInvoices(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("cursor page status=%d body=%s", rr.Code, rr.Body.String())
	}
	if called != 2 {
		t.Fatalf("query called %d times, want 2", called)
	}
}

func TestHandleGetInvoicesRejectsInvalidCursorAndDate(t *testing.T) {
	h := newTestHandler(t)
	h.getInvoicesPageFn = func(context.Context, string, string, string, *int64, int, int, *db.InvoiceCursor) ([]*db.DbInvoice, int, bool, error) {
		t.Fatal("query function must not run for invalid parameters")
		return nil, 0, false, nil
	}
	for _, path := range []string{"/invoices?cursor=bad", "/invoices?due_date=not-a-timestamp", "/invoices?cursor=eyJpZCI6Im9rIiwiY3JlYXRlZF9hdCI6MH0&page=2"} {
		rr := httptest.NewRecorder()
		h.HandleGetInvoices(rr, httptest.NewRequest(http.MethodGet, path, nil))
		if rr.Code != http.StatusBadRequest {
			t.Errorf("%s: status=%d want 400; body=%s", path, rr.Code, rr.Body.String())
		}
	}
}
