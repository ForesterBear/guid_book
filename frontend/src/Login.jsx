import { useState } from 'react';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.endsWith('@mitit.edu.ua')) {
      setError('Доступ дозволено лише для корпоративного домену @mitit.edu.ua');
      return;
    }

    setIsLoading(true);
    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err.message || 'Збій підключення до сервера');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 flex items-center justify-center p-4 font-sans relative overflow-hidden">

      {/* ── Великий водяний знак-логотип позаду ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
      >
        <img
          src="/mitit-logo.png"
          alt=""
          style={{
            width: 'min(70vw, 70vh)',
            height: 'min(70vw, 70vh)',
            objectFit: 'contain',
            opacity: 0.06,
            filter: 'grayscale(30%) brightness(1.2)',
            userSelect: 'none',
          }}
        />
      </div>

      {/* ── Декоративні кола навколо логотипу ── */}
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div style={{
          width: 'min(72vw, 72vh)',
          height: 'min(72vw, 72vh)',
          borderRadius: '50%',
          border: '1px solid rgba(251,146,60,0.08)',
          position: 'absolute',
        }} />
        <div style={{
          width: 'min(80vw, 80vh)',
          height: 'min(80vw, 80vh)',
          borderRadius: '50%',
          border: '1px solid rgba(251,146,60,0.04)',
          position: 'absolute',
        }} />
      </div>

      {/* ── Форма авторизації ── */}
      <div className="bg-white/95 backdrop-blur-sm w-full max-w-md rounded-2xl shadow-2xl shadow-black/40 p-8 sm:p-10 relative overflow-hidden z-10">
        {/* Декоративна лінія зверху картки */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-orange-500 via-orange-400 to-yellow-500"></div>

        <div className="text-center mb-8">
          {/* Офіційний логотип */}
          <div className="mx-auto mb-5 flex items-center justify-center">
            <div className="w-20 h-20 rounded-full overflow-hidden ring-2 ring-orange-400/50 ring-offset-2 ring-offset-white shadow-xl shadow-orange-500/20">
              <img
                src="/mitit-logo.png"
                alt="МІТІТ"
                className="w-full h-full object-contain"
              />
            </div>
          </div>
          <h1 className="text-xl font-black text-gray-900 tracking-tight uppercase leading-tight">
            ІДС «Глосарій-КБ»
          </h1>
          <p className="text-[11px] font-bold text-orange-500 uppercase tracking-[0.2em] mt-1">
            МІТІТ ЗСУ
          </p>
          <p className="text-sm text-gray-400 font-medium mt-2">Авторизація співробітників</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm font-bold rounded-lg text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Корпоративний Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@mitit.edu.ua"
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Пароль</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold py-3.5 px-4 rounded-lg transition-colors shadow-md text-sm uppercase tracking-wide flex justify-center items-center gap-2"
          >
            {isLoading ? 'Перевірка...' : 'Увійти в систему'}
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-gray-400 font-medium">
          Захищено згідно з політиками безпеки. Всі дії логуються.
        </p>
      </div>
    </div>
  );
}
