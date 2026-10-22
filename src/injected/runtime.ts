// 维护源按责任拆分，构建期生成自包含函数；不在页面加载模块或接收配置消息。
export { applyVanishGeoRuntime } from 'virtual:vanishgeo-runtime';
export { pageRuntimeSource } from 'virtual:vanishgeo-page-runtime-source';
export { geolocationRuntimeSource } from 'virtual:vanishgeo-geolocation-runtime-source';
