#!/usr/bin/env python3
"""
Craft, sign, and broadcast a raw CKB Layer-1 transfer — no ckb-cli, no signing
library. Pure-Python secp256k1 (recoverable ECDSA, low-s), CKB molecule
serialization, and the secp256k1_blake160_sighash_all signing scheme.

Used by scripts/testnet-settle.sh to fund the payee node's channel-reserve cell
from the (single) faucet-funded node, so a judge only has to claim the faucet ONCE.

Usage:
  ckb-transfer.py <priv_hex> <to_lock_args_hex> <amount_shannons> <ckb_rpc_url> [fee_shannons]

Prints the broadcast transaction hash on success.
"""
import hashlib
import json
import secrets
import sys
import urllib.request

# ---------------------------------------------------------------- secp256k1
P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8


def inv(a, m):
    return pow(a, -1, m)


def ec_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        m = (3 * x1 * x1) * inv(2 * y1, P) % P
    else:
        m = (y2 - y1) * inv(x2 - x1, P) % P
    x3 = (m * m - x1 - x2) % P
    y3 = (m * (x1 - x3) - y1) % P
    return (x3, y3)


def ec_mul(k, pt):
    r = None
    while k:
        if k & 1:
            r = ec_add(r, pt)
        pt = ec_add(pt, pt)
        k >>= 1
    return r


def pubkey_compressed(priv: int) -> bytes:
    x, y = ec_mul(priv, (GX, GY))
    return bytes([2 + (y & 1)]) + x.to_bytes(32, "big")


def sign_recoverable(priv: int, z: int):
    while True:
        k = secrets.randbelow(N - 1) + 1
        rx, ry = ec_mul(k, (GX, GY))
        r = rx % N
        if r == 0:
            continue
        s = (inv(k, N) * (z + r * priv)) % N
        if s == 0:
            continue
        rec = (ry & 1) | (2 if rx >= N else 0)
        if s > N // 2:  # low-s (BIP-62 / CKB requirement)
            s = N - s
            rec ^= 1
        return r.to_bytes(32, "big") + s.to_bytes(32, "big") + bytes([rec])


# ---------------------------------------------------------------- CKB hash
def ckbhash(b: bytes) -> bytes:
    return hashlib.blake2b(b, digest_size=32, person=b"ckb-default-hash").digest()


def blake160(b: bytes) -> bytes:
    return ckbhash(b)[:20]


# ---------------------------------------------------------------- molecule
def u32(n):
    return n.to_bytes(4, "little")


def u64(n):
    return n.to_bytes(8, "little")


def mol_bytes(b):  # molecule `Bytes` = fixvec<byte>
    return u32(len(b)) + b


def mol_table(fields):
    header = 4 * (len(fields) + 1)
    off = header
    offsets = []
    for f in fields:
        offsets.append(off)
        off += len(f)
    return u32(off) + b"".join(u32(o) for o in offsets) + b"".join(fields)


def mol_fixvec(items):
    return u32(len(items)) + b"".join(items)


def mol_dynvec(items):
    header = 4 * (len(items) + 1)
    off = header
    offsets = []
    for it in items:
        offsets.append(off)
        off += len(it)
    return u32(off) + b"".join(u32(o) for o in offsets) + b"".join(items)


def script(code_hash: bytes, hash_type: int, args: bytes):
    return mol_table([code_hash, bytes([hash_type]), mol_bytes(args)])


def outpoint(tx_hash: bytes, index: int):  # struct
    return tx_hash + u32(index)


def cell_input(since: int, op: bytes):  # struct
    return u64(since) + op


def cell_output(capacity: int, lock: bytes, type_: bytes = b""):  # table
    return mol_table([u64(capacity), lock, type_])


def cell_dep(op: bytes, dep_type: int):  # struct
    return op + bytes([dep_type])


def witness_args(lock=None, input_type=None, output_type=None):
    def opt(x):
        return mol_bytes(x) if x is not None else b""
    return mol_table([opt(lock), opt(input_type), opt(output_type)])


SECP_CODE_HASH = bytes.fromhex("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8")
HASH_TYPE_TYPE = 1
# testnet secp256k1_blake160 dep group (out_point of the genesis dep-group cell)
DEP_TX = bytes.fromhex("f8de3bb47d055cdf460d93a2a6e1b05f7432f9777c8c474abf4eec1d4aee5d37")
DEP_INDEX = 0
DEP_GROUP = 1


def rpc(url, method, params):
    req = urllib.request.Request(
        url,
        data=json.dumps({"id": 1, "jsonrpc": "2.0", "method": method, "params": params}).encode(),
        headers={"content-type": "application/json", "user-agent": "curl/8.5.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.loads(r.read())
    if out.get("error"):
        raise RuntimeError("RPC %s error: %s" % (method, out["error"]))
    return out["result"]


def main():
    priv_hex, to_args_hex, amount_s, url = sys.argv[1:5]
    fee = int(sys.argv[5]) if len(sys.argv) > 5 else 100000  # 0.001 CKB
    priv = int(priv_hex, 16)
    amount = int(amount_s)
    to_args = bytes.fromhex(to_args_hex.removeprefix("0x"))

    pub = pubkey_compressed(priv)
    from_args = blake160(pub)
    from_lock = script(SECP_CODE_HASH, HASH_TYPE_TYPE, from_args)
    to_lock = script(SECP_CODE_HASH, HASH_TYPE_TYPE, to_args)

    # gather inputs from the sender's live cells
    search = {"script": {"code_hash": "0x" + SECP_CODE_HASH.hex(), "hash_type": "type",
                          "args": "0x" + from_args.hex()}, "script_type": "lock"}
    cells = rpc(url, "get_cells", [search, "asc", "0x40"])["objects"]
    inputs, total, cursor = [], 0, []
    for c in cells:
        if c["output"].get("type") or c["output_data"] not in ("0x", ""):
            continue  # only spend plain CKB cells
        inputs.append(c)
        total += int(c["output"]["capacity"], 16)
        if total >= amount + fee + 6100000000:  # leave room for a valid change cell
            break
    if total < amount + fee:
        raise SystemExit("insufficient balance: have %d, need %d" % (total, amount + fee))
    change = total - amount - fee

    input_structs = [cell_input(0, outpoint(bytes.fromhex(c["out_point"]["tx_hash"][2:]),
                                            int(c["out_point"]["index"], 16))) for c in inputs]
    out_cells = [cell_output(amount, to_lock)]
    out_data = [mol_bytes(b"")]
    if change >= 6100000000:
        out_cells.append(cell_output(change, from_lock))
        out_data.append(mol_bytes(b""))
    else:
        fee += change  # dust → fee

    raw = mol_table([
        u32(0),                                   # version
        mol_fixvec([cell_dep(outpoint(DEP_TX, DEP_INDEX), DEP_GROUP)]),  # cell_deps
        mol_fixvec([]),                           # header_deps
        mol_fixvec(input_structs),                # inputs
        mol_dynvec(out_cells),                    # outputs
        mol_dynvec(out_data),                     # outputs_data
    ])
    tx_hash = ckbhash(raw)

    # sighash-all signing message
    placeholder = witness_args(lock=b"\x00" * 65)
    h = hashlib.blake2b(digest_size=32, person=b"ckb-default-hash")
    h.update(tx_hash)
    h.update(u64(len(placeholder)))
    h.update(placeholder)
    sig = sign_recoverable(priv, int.from_bytes(h.digest(), "big"))
    signed_witness0 = witness_args(lock=sig)

    tx_json = {
        "version": "0x0",
        "cell_deps": [{"out_point": {"tx_hash": "0x" + DEP_TX.hex(), "index": "0x0"}, "dep_type": "dep_group"}],
        "header_deps": [],
        "inputs": [{"since": "0x0", "previous_output": {
            "tx_hash": c["out_point"]["tx_hash"], "index": c["out_point"]["index"]}} for c in inputs],
        "outputs": [{"capacity": hex(amount), "lock": {
            "code_hash": "0x" + SECP_CODE_HASH.hex(), "hash_type": "type", "args": "0x" + to_args.hex()}, "type": None}],
        "outputs_data": ["0x"],
        "witnesses": ["0x" + signed_witness0.hex()],
    }
    if len(out_cells) == 2:
        tx_json["outputs"].append({"capacity": hex(change), "lock": {
            "code_hash": "0x" + SECP_CODE_HASH.hex(), "hash_type": "type", "args": "0x" + from_args.hex()}, "type": None})
        tx_json["outputs_data"].append("0x")

    txid = rpc(url, "send_transaction", [tx_json, "passthrough"])
    # sanity: our locally-computed tx hash must equal the node's
    assert txid.lower() == "0x" + tx_hash.hex(), "tx hash mismatch (molecule bug): %s vs 0x%s" % (txid, tx_hash.hex())
    print(txid)


if __name__ == "__main__":
    main()
