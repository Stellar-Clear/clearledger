// Package auth implements the indexer's SEP-10 style wallet authentication: it
// builds and verifies the signed challenge transaction and mints the session
// JWT. It is independent of HTTP transport.
package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stellar/go-stellar-sdk/keypair"
	"github.com/stellar/go-stellar-sdk/txnbuild"
)

// ChallengeOperationName is the ManageData key that identifies a ClearLedger
// authentication challenge.
const ChallengeOperationName = "clearledger auth"

// GenerateChallenge constructs and signs a SEP-10 challenge transaction
func GenerateChallenge(serverKP *keypair.Full, clientAddr string, passphrase string) (string, error) {
	if err := ValidateAccountAddress(clientAddr); err != nil {
		return "", fmt.Errorf("invalid client address: %w", err)
	}

	nonce := make([]byte, 48)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	nonceStr := base64.StdEncoding.EncodeToString(nonce)

	tx, err := txnbuild.NewTransaction(txnbuild.TransactionParams{
		SourceAccount: &txnbuild.SimpleAccount{
			AccountID: serverKP.Address(),
			Sequence:  0,
		},
		IncrementSequenceNum: false,
		BaseFee:              txnbuild.MinBaseFee,
		Preconditions: txnbuild.Preconditions{
			TimeBounds: txnbuild.NewTimebounds(time.Now().Unix(), time.Now().Add(15*time.Minute).Unix()),
		},
		Operations: []txnbuild.Operation{
			&txnbuild.ManageData{
				SourceAccount: clientAddr,
				Name:          ChallengeOperationName,
				Value:         []byte(nonceStr[:64]),
			},
		},
	})
	if err != nil {
		return "", err
	}

	tx, err = tx.Sign(passphrase, serverKP)
	if err != nil {
		return "", err
	}

	return tx.Base64()
}

// VerifyChallenge parses the signed transaction and checks the server and client signatures
func VerifyChallenge(signedXDR string, serverKP *keypair.Full, passphrase string) (string, error) {
	genericTx, err := txnbuild.TransactionFromXDR(signedXDR)
	if err != nil {
		return "", fmt.Errorf("failed to parse XDR: %w", err)
	}

	tx, ok := genericTx.Transaction()
	if !ok {
		return "", errors.New("invalid transaction type")
	}

	srcAcc := tx.SourceAccount()
	if srcAcc.AccountID != serverKP.Address() {
		return "", errors.New("invalid server source account")
	}

	if len(tx.Operations()) != 1 {
		return "", errors.New("must contain exactly one operation")
	}

	op, ok := tx.Operations()[0].(*txnbuild.ManageData)
	if !ok {
		return "", errors.New("operation must be ManageData")
	}

	clientAddr := op.SourceAccount
	if clientAddr == "" {
		return "", errors.New("client source account is empty")
	}
	if err := ValidateAccountAddress(clientAddr); err != nil {
		return "", fmt.Errorf("invalid client source account: %w", err)
	}

	if op.Name != ChallengeOperationName {
		return "", fmt.Errorf("invalid operation name: %s", op.Name)
	}

	tb := tx.Timebounds()
	if tb.MaxTime == 0 {
		return "", errors.New("timebounds must be set")
	}
	now := time.Now().Unix()
	if now < tb.MinTime || now > tb.MaxTime {
		return "", errors.New("challenge has expired or is not yet valid")
	}

	txHash, err := tx.Hash(passphrase)
	if err != nil {
		return "", fmt.Errorf("failed to get transaction hash: %w", err)
	}

	signatures := tx.Signatures()
	serverSigned := false
	clientSigned := false

	for _, sig := range signatures {
		serverKPCheck, _ := keypair.Parse(serverKP.Address())
		if err := serverKPCheck.Verify(txHash[:], sig.Signature); err == nil {
			serverSigned = true
			continue
		}

		clientKP, err := keypair.Parse(clientAddr)
		if err != nil {
			continue
		}
		if err := clientKP.Verify(txHash[:], sig.Signature); err == nil {
			clientSigned = true
		}
	}

	if !serverSigned {
		return "", errors.New("missing server signature")
	}
	if !clientSigned {
		return "", errors.New("missing client signature")
	}

	return clientAddr, nil
}

// GenerateJWT creates a JWT token signed by the server's secret
func GenerateJWT(address string, jwtSecret string, expiryHours int) (string, error) {
	claims := jwt.MapClaims{
		"sub": address,
		"exp": time.Now().Add(time.Duration(expiryHours) * time.Hour).Unix(),
		"iat": time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(jwtSecret))
}
