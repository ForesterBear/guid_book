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
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-gray-900 flex items-center justify-center p-4 font-sans">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl p-8 sm:p-10 relative overflow-hidden">
        {/* Декоративна лінія зверху картки */}
        <div className="absolute top-0 left-0 w-full h-1.5 bg-orange-500"></div>
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl mx-auto flex items-center justify-center text-3xl mb-4 border border-indigo-100 shadow-sm">
            🛡️
          </div>
          <h1 className="text-2xl font-black text-gray-900 tracking-tight uppercase">ІДС "Глосарій-КБ"</h1>
          <p className="text-sm text-gray-500 font-medium mt-2">Авторизація співробітників</p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 text-red-600 text-sm font-bold rounded-lg text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Корпоративний Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@mitit.edu.ua" className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium transition-colors" />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Пароль</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium transition-colors" />
          </div>
          <button type="submit" disabled={isLoading} className="w-full mt-2 bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-bold py-3.5 px-4 rounded-lg transition-colors shadow-md text-sm uppercase tracking-wide flex justify-center items-center gap-2">
            {isLoading ? 'Перевірка...' : 'Увійти в систему'}
          </button>
        </form>
        
        <p className="mt-8 text-center text-xs text-gray-400 font-medium">Захищено згідно з політиками безпеки. Всі дії логуються.</p>
      </div>
    </div>
  );
}