import { badRequest, notFound } from '../errors.js';

/** 极简路由器：支持 /api/tasks/:id 形式的路径参数 */
export function createRouter() {
  const routes = [];

  function add(method, pattern, handler) {
    const keys = [];
    const source = pattern
      .split('/')
      .map((segment) => {
        if (segment.startsWith(':')) {
          keys.push(segment.slice(1));
          return '([^/]+)';
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler, pattern });
  }

  return {
    get: (pattern, handler) => add('GET', pattern, handler),
    post: (pattern, handler) => add('POST', pattern, handler),
    patch: (pattern, handler) => add('PATCH', pattern, handler),
    del: (pattern, handler) => add('DELETE', pattern, handler),
    match(method, pathname) {
      const allowed = new Set();
      for (const route of routes) {
        const found = route.regex.exec(pathname);
        if (!found) continue;
        allowed.add(route.method);
        if (route.method !== method) continue;
        const params = {};
        route.keys.forEach((key, index) => {
          params[key] = decodeURIComponent(found[index + 1]);
        });
        return { handler: route.handler, params };
      }
      return { allowed: [...allowed] };
    },
    get routes() {
      return routes;
    },
    assertNotEmpty() {
      if (routes.length === 0) throw badRequest('未注册任何路由');
    },
    notFoundRoute(pathname) {
      throw notFound(`接口 ${pathname} 不存在`);
    },
  };
}
