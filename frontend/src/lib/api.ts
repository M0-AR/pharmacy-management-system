import axios from 'axios';

const baseURL = (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL || '';

export const api = axios.create({ baseURL: baseURL || undefined });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('pharma_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem('pharma_token');
      localStorage.removeItem('pharma_user');
      if (!window.location.pathname.includes('/login')) window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export function apiError(e: unknown): string {
  const err = e as { response?: { data?: { error?: string } }; message?: string };
  return err?.response?.data?.error || err?.message || 'Something went wrong';
}
