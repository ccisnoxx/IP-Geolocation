// Chrome Linux 支持 SUID 或 user namespace 两种第一层；仍要求 PID/network 与 seccomp 自检通过。
export function chromeSandboxStatus(text) {
  const observed = {
    layerOne: /Layer 1 Sandbox\s+(?:Namespace|SUID)\b/i.test(text) || /(?:Namespace|SUID) sandbox\s+Yes/i.test(text),
    pidNamespaces: /PID namespaces\s+Yes/i.test(text),
    networkNamespaces: /Network namespaces\s+Yes/i.test(text),
    seccompBpf: /Seccomp-BPF sandbox\s+Yes/i.test(text),
    adequate: /adequately sandboxed/i.test(text)
  };
  return { ...observed, status: Object.values(observed).every(value => value === true) ? 'PASS' : 'UNKNOWN' };
}
