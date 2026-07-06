#!/usr/bin/env python3
"""
Derive a CKB address (CKB2021 full format, bech32m) for the secp256k1-blake160
sighash lock from a compressed secp256k1 public key — the same lock a Fiber node
(fnn) uses as its default funding address.

Usage:  ckb-address.py <compressed_pubkey_hex> [ckt|ckb]

Self-tests (bech32m + CKB blake2b) run on every invocation and abort on mismatch,
so a wrong address can never be printed (and a rate-limited faucet claim wasted).
"""
import hashlib
import sys

# ---- bech32m (BIP-350) ----
CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _polymod(values):
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            chk ^= gen[i] if ((b >> i) & 1) else 0
    return chk


def _hrp_expand(hrp):
    return [ord(x) >> 5 for x in hrp] + [0] + [ord(x) & 31 for x in hrp]


def bech32m_encode(hrp, data):
    values = _hrp_expand(hrp) + data
    polymod = _polymod(values + [0, 0, 0, 0, 0, 0]) ^ 0x2BC830A3
    checksum = [(polymod >> 5 * (5 - i)) & 31 for i in range(6)]
    return hrp + "1" + "".join(CHARSET[d] for d in data + checksum)


def convertbits(data, frombits, tobits, pad=True):
    acc = 0
    bits = 0
    ret = []
    maxv = (1 << tobits) - 1
    for b in data:
        acc = (acc << frombits) | b
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            ret.append((acc >> bits) & maxv)
    if pad and bits:
        ret.append((acc << (tobits - bits)) & maxv)
    return ret


def ckb_blake160(data: bytes) -> bytes:
    return hashlib.blake2b(data, digest_size=32, person=b"ckb-default-hash").digest()[:20]


# secp256k1_blake160_sighash_all code hash (system script, testnet + mainnet)
SECP_CODE_HASH = bytes.fromhex(
    "9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"
)
HASH_TYPE_TYPE = 0x01


def address_from_pubkey(pubkey_hex: str, hrp: str = "ckt") -> str:
    pub = bytes.fromhex(pubkey_hex)
    assert pub[0] in (0x02, 0x03) and len(pub) == 33, "expected 33-byte compressed pubkey"
    args = ckb_blake160(pub)
    # CKB2021 full-address payload: 0x00 | code_hash(32) | hash_type(1) | args
    payload = bytes([0x00]) + SECP_CODE_HASH + bytes([HASH_TYPE_TYPE]) + args
    return bech32m_encode(hrp, convertbits(payload, 8, 5, True))


def _self_test():
    assert bech32m_encode("a", []) == "a1lqfn3a", "bech32m self-test failed"
    assert (
        hashlib.blake2b(b"", digest_size=32, person=b"ckb-default-hash").hexdigest()
        == "44f4c69744d5f8c55d642062949dcae49bc4e7ef43d388c5a12f42b5633d163e"
    ), "ckb blake2b self-test failed"


if __name__ == "__main__":
    _self_test()
    if len(sys.argv) < 2:
        sys.exit("usage: ckb-address.py <compressed_pubkey_hex> [ckt|ckb]")
    hrp = sys.argv[2] if len(sys.argv) > 2 else "ckt"
    print(address_from_pubkey(sys.argv[1], hrp))
