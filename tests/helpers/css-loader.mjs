// Node 测试里 options/popup 会 import CSS；Vite 构建需要它，DOM 测试不需要。
// 把 .css 解析成一个空 ESM，其他请求继续交给 tsx / Node 的 loader。
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.css')) {
    return { url: 'data:text/javascript,export default {}', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
