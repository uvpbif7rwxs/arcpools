const RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.mainnet.arc.io";

type RpcResponse = {
  result?: string;
  error?: { message?: string };
};

export function decodeAbiString(value: string | null | undefined): string | null {
  if (!value?.startsWith("0x")) return null;
  const hex = value.slice(2);
  if (hex.length === 64) {
    const text = Buffer.from(hex, "hex").toString("utf8").replace(/\0+$/g, "").trim();
    return text || null;
  }
  if (hex.length < 128) return null;
  const offset = Number.parseInt(hex.slice(0, 64), 16);
  const lengthOffset = offset * 2;
  const length = Number.parseInt(hex.slice(lengthOffset, lengthOffset + 64), 16);
  if (!Number.isFinite(length) || length <= 0) return null;
  const start = lengthOffset + 64;
  const text = Buffer.from(hex.slice(start, start + length * 2), "hex").toString("utf8").trim();
  return text || null;
}

export async function fetchTokenSymbol(
  address: string,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) return null;
  const response = await fetcher(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: address, data: "0x95d89b41" }, "latest"],
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Arc RPC returned ${response.status}`);
  const payload = (await response.json()) as RpcResponse;
  if (payload.error) throw new Error(payload.error.message ?? "Arc RPC eth_call failed");
  return decodeAbiString(payload.result);
}
