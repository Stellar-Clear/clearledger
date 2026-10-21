// Command backfill validates an explicit ledger interval before an operator
// starts a replay. The listener's idempotent event log makes replays safe.
package main

import (
 "flag"
 "fmt"
 "log"
 "clearledger/indexer/config"
)
func main() {
 from := flag.Int("from-ledger", 0, "first ledger (inclusive)")
 to := flag.Int("to-ledger", 0, "last ledger (inclusive)")
 contract := flag.String("contract", "", "contract ID to replay")
 flag.Parse()
 if *from <= 0 || *to < *from { log.Fatalf("invalid ledger range: from-ledger must be positive and to-ledger must be >= from-ledger") }
 if *contract == "" { log.Fatal("contract is required") }
 cfg, err := config.LoadConfig(); if err != nil { log.Fatalf("load config: %v", err) }
 fmt.Printf("Backfill requested: contract=%s ledgers=%d..%d database=%s\n", *contract, *from, *to, cfg.DatabaseURL)
}
