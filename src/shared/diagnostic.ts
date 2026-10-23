export type WebRtcCandidateRisk = 'none' | 'local' | 'public';
function isPrivateIp(value: string): boolean {
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 169 && parts[1] === 254)
    || parts[0] === 127;
}

function extractIpv4(value: string): string[] {
  return String(value || '').match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
}

function extractMdnsHosts(value: string): string[] {
  return String(value || '').match(/\b[a-z0-9-]+\.local\b/gi) || [];
}

export function classifyWebRtcCandidate(candidate: string) {
  const text = String(candidate || '');
  const ips = extractIpv4(text);
  const localIps = ips.filter(isPrivateIp);
  const publicIps = ips.filter((ip) => !isPrivateIp(ip));
  const mdnsHosts = extractMdnsHosts(text);
  const candidateTypeMatch = text.match(/\btyp\s+([a-z0-9-]+)/i);
  return {
    candidate: text,
    type: candidateTypeMatch ? candidateTypeMatch[1].toLowerCase() : '',
    ips,
    localIps,
    publicIps,
    mdnsHosts,
    risk: publicIps.length > 0 ? 'public' as WebRtcCandidateRisk : localIps.length > 0 ? 'local' as WebRtcCandidateRisk : 'none' as WebRtcCandidateRisk
  };
}

export function buildWebRtcLeakSnapshot(input: { candidates?: string[] }) {
  const candidates = Array.isArray(input?.candidates) ? input.candidates.map(String) : [];
  const classified = candidates.map(classifyWebRtcCandidate);
  const exposesLocalIp = classified.some((candidate) => candidate.localIps.length > 0);
  const exposesPublicIp = classified.some((candidate) => candidate.publicIps.length > 0);
  return {
    candidates: classified,
    exposesLocalIp,
    exposesPublicIp
  };
}
