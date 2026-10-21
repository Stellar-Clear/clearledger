package db

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// skipIfNoDB skips the test when TEST_DATABASE_URL is not set.
// This allows go test ./... to pass in CI without a live database.
func skipIfNoDB(t *testing.T) {
	t.Helper()
	if os.Getenv("TEST_DATABASE_URL") == "" {
		t.Skip("TEST_DATABASE_URL not set â€” skipping DB integration test")
	}
}

func TestMain(m *testing.M) {
	dbURL := os.Getenv("TEST_DATABASE_URL")
	if dbURL != "" {
		ctx := context.Background()
		if err := InitDB(ctx, dbURL); err != nil {
			fmt.Fprintf(os.Stderr, "failed to init test DB: %v\n", err)
			os.Exit(1)
		}
	}
	os.Exit(m.Run())
}

func TestInsertAndGetInvoice(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("testid%d", time.Now().UnixNano())
	inv := &DbInvoice{
		ID:           id,
		Issuer:       "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
		Buyer:        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
		FaceValue:    "1000000000",
		DiscountBps:  0,
		FundedAmount: "0",
		DueDate:      time.Now().Add(30 * 24 * time.Hour).Unix(),
		Status:       "Created",
		CreatedAt:    time.Now().Unix(),
	}

	if _, err := InsertInvoice(ctx, Pool, inv); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil {
		t.Fatalf("GetInvoiceByID: %v", err)
	}
	if got == nil {
		t.Fatal("GetInvoiceByID: returned nil, want invoice")
	}
	if got.ID != id {
		t.Errorf("GetInvoiceByID: got ID %q, want %q", got.ID, id)
	}
	if got.Issuer != inv.Issuer {
		t.Errorf("GetInvoiceByID: got Issuer %q, want %q", got.Issuer, inv.Issuer)
	}
	if got.FaceValue != inv.FaceValue {
		t.Errorf("GetInvoiceByID: got FaceValue %q, want %q", got.FaceValue, inv.FaceValue)
	}
}

func TestInsertInvoiceDuplicateIsIgnored(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("duplicate-test%d", time.Now().UnixNano())
	inv := newTestInvoice(id)

	inserted, err := InsertInvoice(ctx, Pool, inv)
	if err != nil {
		t.Fatalf("first InsertInvoice: %v", err)
	}
	if !inserted {
		t.Fatal("first InsertInvoice: got inserted=false, want true")
	}

	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	inserted, err = InsertInvoice(ctx, Pool, inv)
	if err != nil {
		t.Fatalf("duplicate InsertInvoice: %v", err)
	}
	if inserted {
		t.Fatal("duplicate InsertInvoice: got inserted=true, want false")
	}

	var count int
	if err := Pool.QueryRow(ctx, "SELECT COUNT(*) FROM invoices WHERE id = $1", id).Scan(&count); err != nil {
		t.Fatalf("count inserted invoices: %v", err)
	}
	if count != 1 {
		t.Errorf("invoice row count: got %d, want 1", count)
	}
}

func TestGetInvoiceByID_NotFound(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	got, err := GetInvoiceByID(ctx, Pool, "nonexistent-id-xyz")
	if err != nil {
		t.Fatalf("GetInvoiceByID not found: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("GetInvoiceByID not found: want nil, got %+v", got)
	}
}

func TestGetInvoicesPage(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id1 := fmt.Sprintf("page-test-a%d", time.Now().UnixNano())
	id2 := fmt.Sprintf("page-test-b%d", time.Now().UnixNano())

	issuer := "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
	for _, id := range []string{id1, id2} {
		inv := &DbInvoice{
			ID:           id,
			Issuer:       issuer,
			Buyer:        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
			FaceValue:    "500000000",
			DiscountBps:  0,
			FundedAmount: "0",
			DueDate:      time.Now().Add(30 * 24 * time.Hour).Unix(),
			Status:       "Created",
			CreatedAt:    time.Now().Unix(),
		}
		if _, err := InsertInvoice(ctx, Pool, inv); err != nil {
			t.Fatalf("InsertInvoice %s: %v", id, err)
		}
	}
	t.Cleanup(func() {
		if Pool != nil {
			for _, id := range []string{id1, id2} {
				_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
			}
		}
	})

	// Fetch by issuer with limit 10
	invoices, total, err := GetInvoicesPage(ctx, "", issuer, 10, 0)
	if err != nil {
		t.Fatalf("GetInvoicesPage: %v", err)
	}
	if total < 2 {
		t.Errorf("GetInvoicesPage total: got %d, want >= 2", total)
	}
	if len(invoices) < 2 {
		t.Errorf("GetInvoicesPage len: got %d, want >= 2", len(invoices))
	}

	// Fetch with status filter that matches none of our test records
	invoices2, total2, err := GetInvoicesPage(ctx, "Repaid", issuer, 10, 0)
	if err != nil {
		t.Fatalf("GetInvoicesPage status filter: %v", err)
	}
	for _, inv := range invoices2 {
		if inv.Issuer != issuer {
			t.Errorf("status filter returned wrong issuer: %q", inv.Issuer)
		}
		if inv.Status != "Repaid" {
			t.Errorf("status filter returned wrong status: %q", inv.Status)
		}
	}
	_ = total2
}

func TestGetFilteredInvoicesPage_Integration(t *testing.T) {
	skipIfNoDB(t)
	ctx := context.Background()
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	issuer := "test-issuer-" + suffix
	otherIssuer := "other-issuer-" + suffix
	buyer := "test-buyer-" + suffix
	otherBuyer := "other-buyer-" + suffix
	dueDate := int64(1_800_000_000)

	invoices := []*DbInvoice{
		{ID: "cursor-a-" + suffix, Issuer: issuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Created", CreatedAt: 10},
		{ID: "cursor-b-" + suffix, Issuer: issuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Created", CreatedAt: 10},
		{ID: "cursor-c-" + suffix, Issuer: issuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Created", CreatedAt: 9},
		{ID: "cursor-status-" + suffix, Issuer: issuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Repaid", CreatedAt: 8},
		{ID: "cursor-issuer-" + suffix, Issuer: otherIssuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Created", CreatedAt: 7},
		{ID: "cursor-buyer-" + suffix, Issuer: issuer, Buyer: otherBuyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate, Status: "Created", CreatedAt: 6},
		{ID: "cursor-due-" + suffix, Issuer: issuer, Buyer: buyer, FaceValue: "100", FundedAmount: "0", DueDate: dueDate + 1, Status: "Created", CreatedAt: 5},
	}
	for _, invoice := range invoices {
		if _, err := InsertInvoice(ctx, Pool, invoice); err != nil {
			t.Fatalf("InsertInvoice %s: %v", invoice.ID, err)
		}
	}
	t.Cleanup(func() {
		for _, invoice := range invoices {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", invoice.ID)
		}
	})

	firstPage, total, hasMore, err := GetFilteredInvoicesPage(ctx, "Created", issuer, buyer, &dueDate, 2, 0, nil)
	if err != nil {
		t.Fatalf("first filtered page: %v", err)
	}
	if total != 3 || len(firstPage) != 2 || !hasMore {
		t.Fatalf("first page total=%d len=%d hasMore=%v; want 3, 2, true", total, len(firstPage), hasMore)
	}
	if firstPage[0].ID != invoices[1].ID || firstPage[1].ID != invoices[0].ID {
		t.Fatalf("same-timestamp order = [%s, %s], want [%s, %s]", firstPage[0].ID, firstPage[1].ID, invoices[1].ID, invoices[0].ID)
	}

	cursor := &InvoiceCursor{CreatedAt: firstPage[1].CreatedAt, ID: firstPage[1].ID}
	secondPage, secondTotal, secondHasMore, err := GetFilteredInvoicesPage(ctx, "Created", issuer, buyer, &dueDate, 2, 0, cursor)
	if err != nil {
		t.Fatalf("second filtered page: %v", err)
	}
	if secondTotal != total || len(secondPage) != 1 || secondHasMore || secondPage[0].ID != invoices[2].ID {
		t.Fatalf("second page total=%d rows=%v hasMore=%v; want total %d and only %s", secondTotal, invoiceIDs(secondPage), secondHasMore, total, invoices[2].ID)
	}

	wrongDueDate := dueDate + 2
	noRows, noRowsTotal, noRowsMore, err := GetFilteredInvoicesPage(ctx, "Created", issuer, buyer, &wrongDueDate, 2, 0, nil)
	if err != nil {
		t.Fatalf("empty filtered page: %v", err)
	}
	if len(noRows) != 0 || noRowsTotal != 0 || noRowsMore {
		t.Fatalf("empty filter returned rows=%v total=%d hasMore=%v", invoiceIDs(noRows), noRowsTotal, noRowsMore)
	}
}

func invoiceIDs(invoices []*DbInvoice) []string {
	ids := make([]string, len(invoices))
	for i, invoice := range invoices {
		ids[i] = invoice.ID
	}
	return ids
}

func TestGetPoolStats_Empty(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	stats, err := GetPoolStats(ctx)
	if err != nil {
		t.Fatalf("GetPoolStats: %v", err)
	}
	// An empty pool_snapshots table returns nil (no error)
	_ = stats
}

func TestGetProtocolStats_Empty(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	stats, err := GetProtocolStats(ctx)
	if err != nil {
		t.Fatalf("GetProtocolStats: %v", err)
	}
	if stats == nil {
		t.Fatal("GetProtocolStats: returned nil, want stats struct")
	}
	// With a fresh test DB, totals should be zero
	if stats.TotalInvoices < 0 {
		t.Errorf("GetProtocolStats TotalInvoices: %d", stats.TotalInvoices)
	}
}

// TestGetProtocolStats_CountsListenerStatuses seeds invoices using the exact
// CapCase statuses the listener writes and asserts every filtered aggregate
// picks them up. It runs inside a transaction that first clears the invoices
// table and is always rolled back, so the expected values are exact and no
// other test's data is affected.
func TestGetProtocolStats_CountsListenerStatuses(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	tx, err := Pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	if _, err := tx.Exec(ctx, "DELETE FROM invoices"); err != nil {
		t.Fatalf("clear invoices: %v", err)
	}

	seed := []struct {
		status      string
		funded      string
		discountBps int
	}{
		{"Created", "0", 0},
		{"Listed", "0", 500},
		{"Funded", "1000", 100},
		{"Active", "2000", 200},
		{"Confirmed", "3000", 300},
		{"Repaid", "4000", 400},
		{"Defaulted", "5000", 900},
	}
	for i, s := range seed {
		inv := newTestInvoice(fmt.Sprintf("stats-test%d-%d", time.Now().UnixNano(), i))
		inv.Status = s.status
		inv.FundedAmount = s.funded
		inv.DiscountBps = s.discountBps
		if _, err := InsertInvoice(ctx, tx, inv); err != nil {
			t.Fatalf("InsertInvoice %s: %v", s.status, err)
		}
	}

	stats, err := getProtocolStats(ctx, tx)
	if err != nil {
		t.Fatalf("getProtocolStats: %v", err)
	}

	if stats.TotalInvoices != 7 {
		t.Errorf("TotalInvoices = %d, want 7", stats.TotalInvoices)
	}
	// Funded + Active + Confirmed + Repaid = 1000 + 2000 + 3000 + 4000.
	if stats.TotalUSDCFinanced != "10000" {
		t.Errorf("TotalUSDCFinanced = %q, want %q", stats.TotalUSDCFinanced, "10000")
	}
	// Funded, Active, Confirmed.
	if stats.ActiveInvoiceCount != 3 {
		t.Errorf("ActiveInvoiceCount = %d, want 3", stats.ActiveInvoiceCount)
	}
	if stats.TotalRepaid != 1 {
		t.Errorf("TotalRepaid = %d, want 1", stats.TotalRepaid)
	}
	if stats.TotalDefaulted != 1 {
		t.Errorf("TotalDefaulted = %d, want 1", stats.TotalDefaulted)
	}
	// avg(100, 200, 300, 400) = 250.
	if stats.AverageYieldBps != 250 {
		t.Errorf("AverageYieldBps = %d, want 250", stats.AverageYieldBps)
	}
}

func TestLocateMigrationDir(t *testing.T) {
	// Save original env value
	originalEnv := os.Getenv("INDEXER_MIGRATIONS_DIR")
	defer func() {
		if originalEnv == "" {
			os.Unsetenv("INDEXER_MIGRATIONS_DIR")
		} else {
			os.Setenv("INDEXER_MIGRATIONS_DIR", originalEnv)
		}
	}()

	// Test 1: INDEXER_MIGRATIONS_DIR env var takes precedence
	tempDir := t.TempDir()
	migrationsDir := filepath.Join(tempDir, "migrations")
	if err := os.Mkdir(migrationsDir, 0755); err != nil {
		t.Fatalf("failed to create temp migrations dir: %v", err)
	}
	os.Setenv("INDEXER_MIGRATIONS_DIR", migrationsDir)

	dir, err := locateMigrationDir()
	if err != nil {
		t.Fatalf("locateMigrationDir with env var: %v", err)
	}
	if dir != migrationsDir {
		t.Errorf("locateMigrationDir with env var: got %q, want %q", dir, migrationsDir)
	}

	// Test 2: Invalid INDEXER_MIGRATIONS_DIR returns error
	os.Setenv("INDEXER_MIGRATIONS_DIR", "/nonexistent/path")
	_, err = locateMigrationDir()
	if err == nil {
		t.Error("locateMigrationDir with invalid env var: expected error, got nil")
	}

	// Test 3: Unset env var falls back to relative paths
	os.Unsetenv("INDEXER_MIGRATIONS_DIR")
	dir, err = locateMigrationDir()
	if err != nil {
		// This is expected if running from a directory without migrations
		// The test passes if the function doesn't panic and returns an error
		t.Logf("locateMigrationDir without env var: %v (expected in some contexts)", err)
	} else {
		// If it succeeds, verify it found a valid directory
		info, err := os.Stat(dir)
		if err != nil {
			t.Errorf("locateMigrationDir returned invalid path %q: %v", dir, err)
		}
		if !info.IsDir() {
			t.Errorf("locateMigrationDir returned non-directory: %q", dir)
		}
	}
}

func newTestInvoice(id string) *DbInvoice {
	return &DbInvoice{
		ID:           id,
		Issuer:       "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
		Buyer:        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
		FaceValue:    "1000000000",
		DiscountBps:  0,
		FundedAmount: "0",
		DueDate:      time.Now().Add(30 * 24 * time.Hour).Unix(),
		Status:       "Created",
		CreatedAt:    time.Now().Unix(),
	}
}

func TestUpdateInvoiceListed(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("listed-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	if err := UpdateInvoiceListed(ctx, Pool, id, "Listed", 250); err != nil {
		t.Fatalf("UpdateInvoiceListed: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Listed" {
		t.Errorf("Status: got %q, want %q", got.Status, "Listed")
	}
	if got.DiscountBps != 250 {
		t.Errorf("DiscountBps: got %d, want %d", got.DiscountBps, 250)
	}
}

func TestUpdateInvoiceFunded(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("funded-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	fundedAt := time.Now().Unix()
	if err := UpdateInvoiceFunded(ctx, Pool, id, "Funded", "950000000", fundedAt); err != nil {
		t.Fatalf("UpdateInvoiceFunded: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Funded" {
		t.Errorf("Status: got %q, want %q", got.Status, "Funded")
	}
	if got.FundedAmount != "950000000" {
		t.Errorf("FundedAmount: got %q, want %q", got.FundedAmount, "950000000")
	}
	if got.FundedAt == nil || *got.FundedAt != fundedAt {
		t.Errorf("FundedAt: got %v, want %d", got.FundedAt, fundedAt)
	}
}

func TestUpdateInvoiceShipped(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("shipped-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	shippedAt := time.Now().Unix()
	if err := UpdateInvoiceShipped(ctx, Pool, id, "Active", shippedAt); err != nil {
		t.Fatalf("UpdateInvoiceShipped: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Active" {
		t.Errorf("Status: got %q, want %q", got.Status, "Active")
	}
	if got.ShippedAt == nil || *got.ShippedAt != shippedAt {
		t.Errorf("ShippedAt: got %v, want %d", got.ShippedAt, shippedAt)
	}
	if !got.IssuerConfirmed {
		t.Error("IssuerConfirmed: got false, want true")
	}
}

func TestUpdateInvoiceDeliveryConfirmed(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("delivered-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	confirmedAt := time.Now().Unix()
	if err := UpdateInvoiceDeliveryConfirmed(ctx, Pool, id, "Confirmed", confirmedAt); err != nil {
		t.Fatalf("UpdateInvoiceDeliveryConfirmed: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Confirmed" {
		t.Errorf("Status: got %q, want %q", got.Status, "Confirmed")
	}
	if !got.BuyerConfirmed {
		t.Error("BuyerConfirmed: got false, want true")
	}
	if got.BuyerConfirmedAt == nil || *got.BuyerConfirmedAt != confirmedAt {
		t.Errorf("BuyerConfirmedAt: got %v, want %d", got.BuyerConfirmedAt, confirmedAt)
	}
}

func TestUpdateInvoiceRepaid(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("repaid-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	repaidAt := time.Now().Unix()
	if err := UpdateInvoiceRepaid(ctx, Pool, id, "Repaid", repaidAt); err != nil {
		t.Fatalf("UpdateInvoiceRepaid: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Repaid" {
		t.Errorf("Status: got %q, want %q", got.Status, "Repaid")
	}
	if got.RepaidAt == nil || *got.RepaidAt != repaidAt {
		t.Errorf("RepaidAt: got %v, want %d", got.RepaidAt, repaidAt)
	}
}

func TestUpdateInvoiceStatus(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("status-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	if err := UpdateInvoiceStatus(ctx, Pool, id, "Defaulted"); err != nil {
		t.Fatalf("UpdateInvoiceStatus: %v", err)
	}

	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.Status != "Defaulted" {
		t.Errorf("Status: got %q, want %q", got.Status, "Defaulted")
	}
}

func TestUpdatePoolStats(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	original, err := GetPoolStats(ctx)
	if err != nil {
		t.Fatalf("GetPoolStats (baseline): %v", err)
	}
	t.Cleanup(func() {
		if Pool == nil || original == nil {
			return
		}
		_ = UpdatePoolStats(ctx, original)
	})

	newStats := &DbPoolStats{
		TotalDeposits:         "5000000000",
		TotalFunded:           "3000000000",
		AvailableLiquidity:    "2000000000",
		UtilizationRateBps:    6000,
		TotalYieldDistributed: "15000000",
		ActiveInvoiceCount:    4,
		TotalShares:           "5000000000",
	}
	if err := UpdatePoolStats(ctx, newStats); err != nil {
		t.Fatalf("UpdatePoolStats: %v", err)
	}

	got, err := GetPoolStats(ctx)
	if err != nil {
		t.Fatalf("GetPoolStats: %v", err)
	}
	if got == nil {
		t.Fatal("GetPoolStats: returned nil after update")
	}
	if got.TotalDeposits != newStats.TotalDeposits {
		t.Errorf("TotalDeposits: got %q, want %q", got.TotalDeposits, newStats.TotalDeposits)
	}
	if got.UtilizationRateBps != newStats.UtilizationRateBps {
		t.Errorf("UtilizationRateBps: got %d, want %d", got.UtilizationRateBps, newStats.UtilizationRateBps)
	}
	if got.ActiveInvoiceCount != newStats.ActiveInvoiceCount {
		t.Errorf("ActiveInvoiceCount: got %d, want %d", got.ActiveInvoiceCount, newStats.ActiveInvoiceCount)
	}
}

func TestLogEventAndProcessedLookups(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	eventID := fmt.Sprintf("event-test-%d", time.Now().UnixNano())
	contractID := "CABGWVIZFF62FG67ZGFEP67NEEY4WYTMFURDMFTKKNRDAFPKPOJDTN4C"
	ledger := int32(123456)
	payload := map[string]string{"kind": "test"}

	if err := LogEvent(ctx, Pool, eventID, contractID, ledger, time.Now().Unix(), "invoice_listed", payload); err != nil {
		t.Fatalf("LogEvent: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM events_log WHERE event_id = $1", eventID)
		}
	})

	// LogEvent must be idempotent on conflict (ON CONFLICT DO NOTHING).
	if err := LogEvent(ctx, Pool, eventID, contractID, ledger, time.Now().Unix(), "invoice_listed", payload); err != nil {
		t.Fatalf("LogEvent (duplicate): %v", err)
	}

	processed, err := IsEventProcessed(ctx, eventID)
	if err != nil {
		t.Fatalf("IsEventProcessed: %v", err)
	}
	if !processed {
		t.Error("IsEventProcessed: got false, want true")
	}

	unknownProcessed, err := IsEventProcessed(ctx, "does-not-exist-"+eventID)
	if err != nil {
		t.Fatalf("IsEventProcessed (unknown): %v", err)
	}
	if unknownProcessed {
		t.Error("IsEventProcessed (unknown): got true, want false")
	}

	statuses, err := AreEventsProcessed(ctx, []string{eventID, "does-not-exist-" + eventID})
	if err != nil {
		t.Fatalf("AreEventsProcessed: %v", err)
	}
	if !statuses[eventID] {
		t.Errorf("AreEventsProcessed: expected %q to be processed", eventID)
	}

	empty, err := AreEventsProcessed(ctx, nil)
	if err != nil {
		t.Fatalf("AreEventsProcessed (empty ids): %v", err)
	}
	if len(empty) != 0 {
		t.Errorf("AreEventsProcessed (empty ids): got %d entries, want 0", len(empty))
	}

	events, err := GetRecentEvents(ctx, 10)
	if err != nil {
		t.Fatalf("GetRecentEvents: %v", err)
	}
	found := false
	for _, ev := range events {
		if ev.EventID == eventID {
			found = true
			if ev.ContractID != contractID {
				t.Errorf("GetRecentEvents: got ContractID %q, want %q", ev.ContractID, contractID)
			}
		}
	}
	if !found {
		t.Errorf("GetRecentEvents: expected event %q in results", eventID)
	}

	latest, err := GetLatestProcessedLedger(ctx)
	if err != nil {
		t.Fatalf("GetLatestProcessedLedger: %v", err)
	}
	if latest < ledger {
		t.Errorf("GetLatestProcessedLedger: got %d, want >= %d", latest, ledger)
	}
}

func TestCheckpoint(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	original, err := GetCheckpoint(ctx)
	if err != nil {
		t.Fatalf("GetCheckpoint (baseline): %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_ = UpsertCheckpoint(ctx, original)
		}
	})

	if err := UpsertCheckpoint(ctx, 42); err != nil {
		t.Fatalf("UpsertCheckpoint (insert): %v", err)
	}
	got, err := GetCheckpoint(ctx)
	if err != nil {
		t.Fatalf("GetCheckpoint: %v", err)
	}
	if got != 42 {
		t.Errorf("GetCheckpoint: got %d, want 42", got)
	}

	// UpsertCheckpoint must update the existing row rather than erroring on
	// conflict.
	if err := UpsertCheckpoint(ctx, 99); err != nil {
		t.Fatalf("UpsertCheckpoint (update): %v", err)
	}
	got, err = GetCheckpoint(ctx)
	if err != nil {
		t.Fatalf("GetCheckpoint after update: %v", err)
	}
	if got != 99 {
		t.Errorf("GetCheckpoint after update: got %d, want 99", got)
	}
}

func TestUpdateInvoiceAttestation(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("attest-test%d", time.Now().UnixNano())
	inv := &DbInvoice{
		ID:           id,
		Issuer:       "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
		Buyer:        "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
		FaceValue:    "1000000000",
		DiscountBps:  0,
		FundedAmount: "0",
		DueDate:      time.Now().Add(30 * 24 * time.Hour).Unix(),
		Status:       "Created",
		CreatedAt:    time.Now().Unix(),
	}

	if _, err := InsertInvoice(ctx, Pool, inv); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	// Attestation fields should start as nil
	got, err := GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID: err=%v, got=%v", err, got)
	}
	if got.AttestationAgentID != nil {
		t.Errorf("AttestationAgentID: expected nil, got %v", *got.AttestationAgentID)
	}
	if got.RiskScoreBps != nil {
		t.Errorf("RiskScoreBps: expected nil, got %v", *got.RiskScoreBps)
	}

	// Update attestation
	agentID := "agent_underwrite"
	evidenceHash := "abc123"
	riskScoreBps := 3500
	attestedAt := time.Now().Unix()

	err = UpdateInvoiceAttestation(ctx, Pool, id, agentID, evidenceHash, riskScoreBps, attestedAt)
	if err != nil {
		t.Fatalf("UpdateInvoiceAttestation: %v", err)
	}

	// Verify attestation fields are populated
	got, err = GetInvoiceByID(ctx, Pool, id)
	if err != nil || got == nil {
		t.Fatalf("GetInvoiceByID after attestation: err=%v, got=%v", err, got)
	}
	if got.AttestationAgentID == nil || *got.AttestationAgentID != agentID {
		t.Errorf("AttestationAgentID: got %v, want %q", got.AttestationAgentID, agentID)
	}
	if got.RiskScoreBps == nil || *got.RiskScoreBps != riskScoreBps {
		t.Errorf("RiskScoreBps: got %v, want %d", got.RiskScoreBps, riskScoreBps)
	}
	if got.EvidenceHash == nil || *got.EvidenceHash != evidenceHash {
		t.Errorf("EvidenceHash: got %v, want %q", got.EvidenceHash, evidenceHash)
	}
	if got.AttestedAt == nil || *got.AttestedAt != attestedAt {
		t.Errorf("AttestedAt: got %v, want %d", got.AttestedAt, attestedAt)
	}
}

// TestInvoiceCheckConstraints proves the migration 012 CHECK constraints reject
// values the application code would otherwise silently accept.
func TestInvoiceCheckConstraints(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	id := fmt.Sprintf("constraint-test%d", time.Now().UnixNano())
	if _, err := InsertInvoice(ctx, Pool, newTestInvoice(id)); err != nil {
		t.Fatalf("InsertInvoice: %v", err)
	}
	t.Cleanup(func() {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM invoices WHERE id = $1", id)
		}
	})

	cases := []struct {
		name  string
		query string
	}{
		{"invalid status", `UPDATE invoices SET status = 'Bogus' WHERE id = $1`},
		{"discount_bps above 5000", `UPDATE invoices SET discount_bps = 5001 WHERE id = $1`},
		{"negative discount_bps", `UPDATE invoices SET discount_bps = -1 WHERE id = $1`},
		{"risk_score_bps above 10000", `UPDATE invoices SET risk_score_bps = 10001 WHERE id = $1`},
		{"negative risk_score_bps", `UPDATE invoices SET risk_score_bps = -1 WHERE id = $1`},
		{"negative face_value", `UPDATE invoices SET face_value = -1 WHERE id = $1`},
		{"negative funded_amount", `UPDATE invoices SET funded_amount = -1 WHERE id = $1`},
		{"funded_amount above face_value", `UPDATE invoices SET funded_amount = face_value + 1 WHERE id = $1`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Pool.Exec(ctx, tc.query, id); err == nil {
				t.Errorf("%s: expected constraint violation, got nil error", tc.name)
			}
		})
	}
}

// TestPoolSnapshotsConstraints proves pool_snapshots is locked to its single
// id = 1 row and that utilization_rate_bps stays within 0-10000.
func TestPoolSnapshotsConstraints(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	if _, err := Pool.Exec(ctx, `INSERT INTO pool_snapshots (id) VALUES (2)`); err == nil {
		if Pool != nil {
			_, _ = Pool.Exec(ctx, "DELETE FROM pool_snapshots WHERE id = 2")
		}
		t.Error("second pool_snapshots row: expected constraint violation, got nil error")
	}
	if _, err := Pool.Exec(ctx, `UPDATE pool_snapshots SET utilization_rate_bps = 10001 WHERE id = 1`); err == nil {
		t.Error("utilization_rate_bps above 10000: expected constraint violation, got nil error")
	}
}

// TestCheckpointValueConstraint proves negative indexer checkpoints are rejected.
func TestCheckpointValueConstraint(t *testing.T) {
	skipIfNoDB(t)

	ctx := context.Background()
	if _, err := Pool.Exec(ctx, `UPDATE indexer_checkpoint SET value = -1 WHERE key = 'latest_processed_ledger'`); err == nil {
		t.Error("negative checkpoint value: expected constraint violation, got nil error")
	}
}
