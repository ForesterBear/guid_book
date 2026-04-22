import { useState, useCallback, useEffect } from 'react';

export function useAuth() {
  const [accessToken, setAccessToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST' });
      if (!res.ok) throw new Error('Refresh failed');
      const data = await res.json();
      setAccessToken(data.accessToken);
      return data.accessToken;
    } catch {
      setAccessToken(null);
      setUser(null);
      localStorage.removeItem('user');
      return null;
    }
  }, []);

  // При завантаженні сторінки дістаємо користувача з пам'яті і поновлюємо токен
  useEffect(() => {
    const initAuth = async () => {
      const savedUser = localStorage.getItem('user');
      if (savedUser) {
        // Чекаємо на оновлення токена ПЕРЕД тим як показувати дашборд
        const token = await refresh();
        if (token) {
          setUser(JSON.parse(savedUser));
        } else {
          localStorage.removeItem('user');
        }
      }
      setIsInitialized(true);
    };
    initAuth();
  }, [refresh]);

  // Автоматичне оновлення токена кожні 14 хвилин
  useEffect(() => {
    if (!accessToken) return;
    const interval = setInterval(async () => {
      await refresh();
    }, 14 * 60 * 1000);
    return () => clearInterval(interval);
  }, [accessToken, refresh]);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Помилка авторизації');
      }
      const data = await res.json();
      setAccessToken(data.accessToken);
      setUser(data.user);
      localStorage.setItem('user', JSON.stringify(data.user));
      return true;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    // Очищуємо стан МИТТЄВО, щоб одразу викинути на екран логіну
    setAccessToken(null);
    setUser(null);
    localStorage.removeItem('user');
    
    // Робимо запит у фоні
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch(e) {}
  }, []);

  const authFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    // Якщо токен протух — оновлюємо і повторюємо запит
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'TOKEN_EXPIRED') {
        const newToken = await refresh();
        if (newToken) {
          return fetch(url, {
            ...options,
            headers: { ...options.headers, Authorization: `Bearer ${newToken}` }
          });
        }
      }
      logout();
      throw new Error('Сесія закінчилась або доступ заборонено. Увійдіть знову.');
    }
    return res;
  }, [accessToken, refresh, logout]);

  return { user, accessToken, loading, isInitialized, login, logout, authFetch };
}