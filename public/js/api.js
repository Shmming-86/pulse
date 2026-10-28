let currentUser = 'm_lin';

/** 当前操作人（演示项目以本地状态模拟登录态） */
export function setCurrentUser(id) {
  if (typeof id === 'string' && id) currentUser = id;
}

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.offline = offline;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 统一请求封装：
 * - 自动附加当前用户（演示项目，真实应用应由登录态提供）
 * - 5xx / 网络错误对幂等请求做最多 3 次指数退避重试
 * - 4xx 不重试，直接抛出可读错误
 * - 后端错误结构统一映射为 ApiError
 */
async function request(method, path, body, { retries = method === 'GET' ? 3 : 0 } = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    try {
      const response = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-Actor-Id': currentUser,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      if (response.status === 204) return null;

      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        const error = payload?.error ?? {};
        const apiError = new ApiError(error.message ?? `请求失败（${response.status}）`, {
          status: response.status,
          code: error.code ?? 'HTTP_ERROR',
          details: error.details ?? null,
        });
        // 5xx 允许重试，4xx 立即失败
        if (response.status >= 500 && attempt < retries) {
          lastError = apiError;
          attempt += 1;
          await sleep(300 * 2 ** (attempt - 1));
          continue;
        }
        throw apiError;
      }

      return payload?.data ?? null;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      lastError = new ApiError('网络连接失败，请检查网络或服务是否已启动', { offline: true });
      if (attempt < retries) {
        attempt += 1;
        await sleep(300 * 2 ** (attempt - 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new ApiError('请求失败');
}

export const api = {
  bootstrap: () => request('GET', '/api/bootstrap'),
  analytics: () => request('GET', '/api/analytics'),
  activity: (limit = 60) => request('GET', `/api/activity?limit=${limit}`),
  createTask: (payload) => request('POST', '/api/tasks', payload),
  updateTask: (id, patch) => request('PATCH', `/api/tasks/${id}`, patch),
  moveTask: (id, payload) => request('POST', `/api/tasks/${id}/move`, payload),
  deleteTask: (id) => request('DELETE', `/api/tasks/${id}`),
  addSubtask: (id, title) => request('POST', `/api/tasks/${id}/subtasks`, { title }),
  toggleSubtask: (id, subtaskId) => request('PATCH', `/api/tasks/${id}/subtasks/${subtaskId}`),
  removeSubtask: (id, subtaskId) => request('DELETE', `/api/tasks/${id}/subtasks/${subtaskId}`),
  members: () => request('GET', '/api/members'),
  createMember: (payload) => request('POST', '/api/members', payload),
  updateMember: (id, patch) => request('PATCH', `/api/members/${id}`, patch),
  deleteMember: (id, reassignTo) =>
    request(
      'DELETE',
      `/api/members/${id}${reassignTo ? `?reassignTo=${encodeURIComponent(reassignTo)}` : ''}`,
    ),
  columns: () => request('GET', '/api/columns'),
  createColumn: (payload) => request('POST', '/api/columns', payload),
  updateColumn: (id, patch) => request('PATCH', `/api/columns/${id}`, patch),
  moveColumn: (id, index) => request('POST', `/api/columns/${id}/move`, { index }),
  deleteColumn: (id, moveTo) =>
    request(
      'DELETE',
      `/api/columns/${id}${moveTo ? `?moveTo=${encodeURIComponent(moveTo)}` : ''}`,
    ),
  health: () => request('GET', '/api/health', undefined, { retries: 0 }),
};
