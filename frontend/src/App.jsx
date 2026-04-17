import { useState, useEffect } from 'react'
import './index.css'

function App() {
  const [terms, setTerms] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [uploadFile, setUploadFile] = useState(null)
  const [accessLevel, setAccessLevel] = useState('')
  const [pendingTerms, setPendingTerms] = useState([])
  const [pendingSourceId, setPendingSourceId] = useState(null)
  const [showVerification, setShowVerification] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' або 'admin'
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedTerm, setSelectedTerm] = useState(null) // Стан для Slide-over панелі
  const [favorites, setFavorites] = useState([]) // Стан для збереження обраних термінів
  const [history, setHistory] = useState([]) // Стан для збереження історії переглядів

  // Мокові дані для матриці доступів
  const [users, setUsers] = useState([
    { id: 1, name: 'Михайло Кльоц', role: 'Адміністратор', clearance: 'Secret', status: 'Активний' },
    { id: 2, name: 'Іван Петренко', role: 'Аналітик', clearance: 'DSP', status: 'Активний' },
    { id: 3, name: 'Олена Коваленко', role: 'Оператор', clearance: 'Public', status: 'Очікує підтвердження' },
  ])

  useEffect(() => {
    fetchTerms()
  }, [])

  const fetchTerms = async () => {
    try {
      console.log('[Frontend] Запит на отримання всіх термінів...');
      const response = await fetch('http://localhost:3001/terms')
      const data = await response.json()
      console.log(`[Frontend] Успішно завантажено ${data.length} термінів.`);
      setTerms(data)
    } catch (error) {
      console.error('Failed to fetch terms:', error)
    }
  }

  const addToHistory = (query, type = 'Пошук') => {
    setHistory(prev => {
      const newItem = { id: Date.now(), title: query, type, time: new Date().toLocaleTimeString() };
      return [newItem, ...prev.filter(h => h.title !== query)];
    });
  };

  const handleSearch = async (queryOverride) => {
    const query = typeof queryOverride === 'string' ? queryOverride : searchQuery;
    if (!query) return;
    setSearchQuery(query);
    setActiveTab('search');
    addToHistory(query, 'Пошук');
    try {
      console.log(`[Frontend] Виконання базового пошуку за запитом: "${query}"`);
      const response = await fetch(`http://localhost:3001/search?q=${query}`)
      const data = await response.json()
      console.log(`[Frontend] Результати пошуку: знайдено ${data.length} збігів.`);
      setTerms(data)
    } catch (error) {
      console.error('Search failed:', error)
    }
  }

  const handleSemanticSearch = async () => {
    if (!searchQuery) return;
    setActiveTab('search');
    addToHistory(searchQuery, 'AI Пошук');
    try {
      console.log(`[Frontend] Виконання семантичного пошуку за запитом: "${searchQuery}"`);
      const response = await fetch(`http://localhost:3001/semantic-search?q=${searchQuery}`)
      const data = await response.json()
      setTerms(data.map(item => ({
        id: item.termId,
        term_name: item.termName,
        definition: item.definition || item.content?.split(': ')[1] || item.content,
        source_id: item.source_id,
        file_type: item.file_type,
        security_stamp: 'Public' // Fallback для семантичного пошуку
      })))
      console.log(`[Frontend] Результати семантичного пошуку: отримано ${data.length} збігів.`);
    } catch (error) {
      console.error('Semantic search failed:', error)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile || !accessLevel) {
      console.log('[Frontend] Спроба завантаження перервана: не вибрано файл або рівень доступу.');
      alert('Please select a file and specify access level')
      return
    }

    const formData = new FormData()
    formData.append('file', uploadFile)
    formData.append('accessLevel', accessLevel)

    try {
      console.log(`[Frontend] Початок завантаження файлу: ${uploadFile.name}, рівень доступу: ${accessLevel}`);
      setIsProcessing(true)
      setUploadStatus('Uploading document...')

      const response = await fetch('http://localhost:3001/upload', {
        method: 'POST',
        body: formData
      })
      const result = await response.json()

      if (!response.ok) {
        console.error('[Frontend] Помилка завантаження файлу:', result);
        setUploadStatus(result.error || result.message || 'Upload failed. Please try again.')
        return
      }

      if (result.pendingTerms) {
        console.log(`[Frontend] AI проаналізував файл. Очікується підтвердження ${result.pendingTerms.length} термінів.`);
        // Додаємо категорію за замовчуванням до знайдених термінів
        setPendingTerms(result.pendingTerms.map(t => ({ ...t, category: 'IT-термінологія' })))
        setPendingSourceId(result.sourceId)
        setShowVerification(true)
        setUploadStatus('Document processed by AI. Please verify the extracted terms.')
      } else {
        console.log('[Frontend] Завантаження успішне. AI не знайшов термінів.');
        setUploadStatus(result.message || 'Upload completed')
        fetchTerms()
      }
    } catch (error) {
      console.error('Upload failed:', error)
      setUploadStatus('Upload failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const confirmTerms = async () => {
    try {
      console.log(`[Frontend] Підтвердження та відправка ${pendingTerms.length} термінів до БД...`);
      await fetch('http://localhost:3001/confirm-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: pendingTerms, sourceId: pendingSourceId })
      })
      setShowVerification(false)
      setPendingTerms([])
      setPendingSourceId(null)
      console.log('[Frontend] Терміни успішно підтверджені та збережені.');
      fetchTerms()
    } catch (error) {
      console.error('Confirmation failed:', error)
    }
  }

  const handlePendingTermChange = (index, field, value) => {
    const updatedTerms = [...pendingTerms];
    updatedTerms[index][field] = value;
    setPendingTerms(updatedTerms);
  };

  const handleDeletePendingTerm = (index) => {
    setPendingTerms(pendingTerms.filter((_, i) => i !== index));
  };

  const openSource = (term) => {
    console.log(`[Frontend] Відкриття джерела документа ID: ${term.source_id}`);
    window.open(`http://localhost:3001/source/${term.source_id}`, '_blank')
  }

  const openTermDetails = (term) => {
    setSelectedTerm(term);
    addToHistory(term.term_name, 'Перегляд'); // Записуємо перегляд в історію при відкритті панелі
  }

  const openCategory = async (category) => {
    setSelectedCategory(category);
    setActiveTab('category');
    try {
      const response = await fetch(`http://localhost:3001/terms?category=${encodeURIComponent(category.title)}`)
      const data = await response.json()
      setTerms(data)
    } catch (error) {
      console.error('Failed to fetch category terms:', error)
    }
  }

  const toggleFavorite = (term) => {
    setFavorites(prev => {
      const isFav = prev.some(t => t.id === term.id);
      if (isFav) return prev.filter(t => t.id !== term.id);
      return [...prev, term];
    });
  };

  // Хелпери для кольорів грифів секретності
  const getSecurityColor = (stamp) => {
    if (stamp === 'Secret') return 'border-t-red-500';
    if (stamp === 'DSP') return 'border-t-yellow-500';
    return 'border-t-green-500'; 
  };
  const getSecurityLabel = (stamp) => {
    if (stamp === 'Secret') return 'ТАЄМНО';
    if (stamp === 'DSP') return 'ДСК';
    return 'ВІДКРИТО'; 
  };
  const getSecurityBg = (stamp) => {
    if (stamp === 'Secret') return 'bg-red-50 text-red-700 border-red-200';
    if (stamp === 'DSP') return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    return 'bg-green-50 text-green-700 border-green-200'; 
  };

  const categories = [
    { title: 'Системи зв’язку', icon: '📡', count: 412, colSpan: 'md:col-span-2', desc: 'Телекомунікації, радіообладнання, апаратне забезпечення та протоколи передачі даних.' },
    { title: 'Кібербезпека', icon: '🛡️', count: 285, colSpan: 'md:col-span-1', desc: 'Захист від кібератак, хакерів та активний захист ІТ-мереж.' },
    { title: 'Криптографія', icon: '🔑', count: 154, colSpan: 'md:col-span-1', desc: 'Шифрування, криптографічні алгоритми, генерація ключів та захист.' },
    { title: 'Нормативні акти', icon: '📜', count: 98, colSpan: 'md:col-span-1', desc: 'Військові доктрини, закони, статути, накази та державні правила.' },
    { title: 'Радіоелектронна боротьба', icon: '📻', count: 110, colSpan: 'md:col-span-1', desc: 'РЕБ, активне глушіння, радари, радіорозвідка та пеленгація.' },
    { title: 'IT-термінологія', icon: '💻', count: 320, colSpan: 'md:col-span-3 lg:col-span-3', desc: 'Програмне забезпечення, штучний інтелект, алгоритми, загальні обчислення та бази даних.' },
  ];

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex font-sans">
      {isProcessing && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl p-8 text-center shadow-2xl max-w-sm w-full mx-4">
            <div className="w-12 h-12 border-4 border-gray-200 border-t-orange-500 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-800 font-medium">{uploadStatus}</p>
          </div>
        </div>
      )}

      {/* Бокова панель (Sidebar) */}
      <aside className="w-64 bg-gray-900 text-gray-300 flex-shrink-0 hidden md:flex flex-col shadow-xl z-10">
        <div className="p-6">
          <h1 className="text-white text-xl font-bold flex items-center gap-3">
            <span className="text-orange-500 text-2xl">🛡️</span> ІДС "Глосарій-КБ"
          </h1>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-4">
          <nav className="px-4 space-y-1 mb-8">
            <a href="#" onClick={() => setActiveTab('dashboard')} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'dashboard' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">🏠</span> Головна
            </a>
            <a href="#" onClick={() => { setActiveTab('my-terms'); fetchTerms(); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'my-terms' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">👤</span> Мої терміни
            </a>
            <a href="#" onClick={() => setActiveTab('favorites')} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'favorites' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">⭐</span> Обране
            </a>
            <a href="#" onClick={() => setActiveTab('history')} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'history' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">🕒</span> Історія переглядів
            </a>
          </nav>
        </div>

        <div className="p-4 border-t border-gray-800 space-y-1">
          <a href="#" onClick={() => setActiveTab('upload')} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'upload' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
            <span className="text-lg">📥</span> Завантаження
          </a>
          <a href="#" className="flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all hover:bg-gray-800 hover:text-red-400">
            <span className="text-lg">🚪</span> Вийти
          </a>
        </div>
      </aside>

      {/* Головна робоча зона */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Верхня панель (Header) */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-sm z-0">
              <div className="flex-1 max-w-2xl flex items-center gap-2 pr-8">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Пошук термінів (наприклад: шифрування)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full pl-10 p-2.5"
                  />
                </div>
                <button onClick={() => handleSearch(searchQuery)} className="hidden sm:block bg-gray-800 hover:bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Знайти</button>
                <button onClick={handleSemanticSearch} className="hidden sm:block bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors" title="AI Семантичний пошук">✨ AI</button>
                {(terms.length > 0 || searchQuery) && (
                  <button onClick={() => { setSearchQuery(''); setActiveTab('dashboard'); fetchTerms(); }} className="text-gray-500 hover:text-red-500 px-2 text-sm font-medium transition-colors">Скинути</button>
                )}
              </div>
              <div className="flex items-center gap-4 border-l border-gray-200 pl-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-gray-800 cursor-pointer hover:text-orange-600 flex items-center gap-1" onClick={() => setActiveTab('admin')}>
                    Михайло Кльоц <span className="text-xs">▼</span>
                  </p>
                  <p className="text-xs text-gray-500">Адміністратор</p>
                </div>
                <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold border border-orange-200 shadow-sm cursor-pointer hover:bg-orange-200 transition-colors" onClick={() => setActiveTab('admin')}>
                  МК
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-8 bg-gray-50">
              {activeTab === 'dashboard' ? (
                <>
                  {/* Банер привітання та статистика */}
                  <div className="bg-white border-l-4 border-orange-500 p-6 rounded-xl shadow-sm mb-8 border-y border-r border-gray-200">
                    <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-tight">ВІТАЄМО, МИХАЙЛЕ!</h2>
                    <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-blue-500 w-full"></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Всього в БД</p>
                        <p className="text-4xl font-black text-gray-800">{terms.length > 0 ? terms.length : 1450}</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-green-500 w-[98%]"></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Актуальність</p>
                        <p className="text-4xl font-black text-green-600">98%</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-orange-500 w-[15%]"></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Опрацьовано ШІ</p>
                        <p className="text-4xl font-black text-orange-600">210</p>
                      </div>
                    </div>
                  </div>

                  {/* Плитки категорій */}
                  <div className="mb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {categories.map((cat) => (
                        <div key={cat.title} onClick={() => openCategory(cat)} className={`bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between hover:shadow-xl hover:border-orange-200 hover:-translate-y-1.5 transition-all cursor-pointer min-h-[220px] group ${cat.colSpan}`}>
                          <div>
                            <div className="flex justify-between items-start">
                              <h3 className="text-2xl font-bold text-gray-800 group-hover:text-orange-600 transition-colors">{cat.title}</h3>
                              <span className="text-5xl opacity-40 group-hover:opacity-100 group-hover:scale-110 transition-all">{cat.icon}</span>
                            </div>
                            <p className="text-gray-500 mt-3 text-sm leading-relaxed font-medium pr-8">{cat.desc}</p>
                          </div>
                          <div className="mt-6 flex items-center gap-3">
                            <span className="px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg font-bold text-sm border border-orange-100">
                              {cat.count} термінів
                            </span>
                            <span className="text-gray-400 text-sm font-bold group-hover:text-orange-500 transition-colors ml-auto">Перейти →</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {/* Списки термінів винесено в окремі вкладки */}
              {['category', 'search', 'my-terms', 'favorites'].includes(activeTab) && (
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex justify-between items-end mb-6 border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-tight">
                        {activeTab === 'category' && selectedCategory ? `📁 Категорія: ${selectedCategory.title}` : 
                         activeTab === 'search' ? `🔍 Результати пошуку: ${searchQuery}` : 
                         activeTab === 'favorites' ? `⭐ Обрані терміни` :
                         '👤 Мої додані терміни'}
                      </h2>
                      <p className="text-sm text-gray-500 font-medium mt-1">Знайдено записів: {(activeTab === 'favorites' ? favorites : terms).length}</p>
                    </div>
                    <button onClick={() => { setActiveTab('dashboard'); setSearchQuery(''); }} className="bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2 px-4 rounded-lg transition-colors text-sm flex items-center gap-2">
                      <span>←</span> На Головну
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {(activeTab === 'favorites' ? favorites : terms).map(term => (
                      <div key={term.id} className={`p-6 border border-t-4 ${getSecurityColor(term.security_stamp)} rounded-xl shadow-sm transition-all hover:shadow-md flex flex-col relative overflow-hidden ${term.is_actual ? 'bg-white' : 'bg-gray-50'}`}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center">
                            <h3 onClick={() => openTermDetails(term)} className={`text-lg font-bold leading-tight cursor-pointer hover:text-orange-600 transition-colors ${term.is_actual ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                              {term.term_name.toUpperCase()}
                              {!term.is_actual && <span className="text-sm font-normal text-gray-400 ml-2 block sm:inline mt-1 sm:mt-0">(Застаріле)</span>}
                            </h3>
                            <button onClick={() => toggleFavorite(term)} className={`ml-3 text-2xl transition-all focus:outline-none ${favorites.some(t => t.id === term.id) ? 'text-yellow-400 hover:text-yellow-500 scale-110' : 'text-gray-300 hover:text-gray-400 hover:scale-110'} active:scale-95`} title="Додати до обраного">
                              {favorites.some(t => t.id === term.id) ? '★' : '☆'}
                            </button>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-black border tracking-wider uppercase ${getSecurityBg(term.security_stamp)}`}>
                              {getSecurityLabel(term.security_stamp)}
                            </span>
                            <span className={`shrink-0 px-2.5 py-1 rounded-md text-xs font-bold border tracking-wide uppercase ${term.is_actual ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-gray-200 text-gray-500 border-gray-300'}`}>
                              {term.is_actual ? 'Актуально' : 'Застаріло'}
                            </span>
                          </div>
                        </div>
                        <p className={`text-sm mb-5 line-clamp-4 hover:line-clamp-none ${term.is_actual ? 'text-gray-700' : 'text-gray-500'}`}>
                          {term.definition}
                        </p>
                        <div className="flex items-center justify-between border-t border-gray-200 pt-4 text-sm mt-auto">
                          <button onClick={() => openSource(term)} className="flex items-center gap-2 text-orange-600 hover:text-orange-800 hover:underline font-bold transition-colors">
                            <span>📄</span> Відкрити джерело 
                            <span className="uppercase text-[10px] font-black text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded border border-gray-300">.{term.file_type}</span>
                          </button>
                        </div>
                      </div>
                    ))}
                    {(activeTab === 'favorites' ? favorites : terms).length === 0 && (
                       <div className="col-span-full text-center py-12 text-gray-500 font-medium">
                         За даним запитом термінів не знайдено.
                       </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'history' && (
                <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex justify-between items-end mb-6 border-b border-gray-100 pb-4">
                    <div>
                      <h2 className="text-2xl font-bold text-gray-800 uppercase tracking-tight">🕒 Історія активності</h2>
                      <p className="text-sm text-gray-500 font-medium mt-1">Останні пошукові запити та перегляди</p>
                    </div>
                    <button onClick={() => setHistory([])} className="bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2 px-4 rounded-lg transition-colors text-sm flex items-center gap-2 border border-red-200">
                      Очистити історію
                    </button>
                  </div>
                  
                  {history.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                            <th className="p-4 font-semibold rounded-tl-lg">Час</th>
                            <th className="p-4 font-semibold">Дія</th>
                            <th className="p-4 font-semibold">Запит / Термін</th>
                            <th className="p-4 font-semibold rounded-tr-lg text-right">Перейти</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-gray-100">
                          {history.map(item => (
                            <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4 text-gray-500 font-medium whitespace-nowrap">{item.time}</td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold border ${item.type === 'Пошук' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                                  {item.type}
                                </span>
                              </td>
                              <td className="p-4 font-bold text-gray-900 w-full">{item.title}</td>
                              <td className="p-4 text-right">
                                <button onClick={() => handleSearch(item.title)} className="text-orange-500 hover:text-orange-700 font-bold whitespace-nowrap flex items-center gap-1">
                                  Відкрити ↗
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-500 font-medium">Історія порожня. Почніть пошук термінів!</div>
                  )}
                </div>
              )}

              {activeTab === 'upload' ? (
                <div className="max-w-4xl mx-auto bg-white p-10 rounded-xl shadow-sm border border-gray-200">
                  <h2 className="text-2xl font-bold text-gray-800 mb-6 uppercase tracking-tight border-b border-gray-100 pb-4">Завантаження документа</h2>
                  
                  <div className="border-2 border-dashed border-orange-300 bg-orange-50/50 rounded-xl p-12 text-center hover:bg-orange-50 transition-colors mb-8 relative">
                    <span className="text-5xl mb-4 block">📥</span>
                    <p className="text-gray-800 font-bold text-lg mb-2">Перетягніть PDF або DOCX сюди</p>
                    <p className="text-gray-500 text-sm mb-4">Або натисніть для вибору файлу на комп'ютері</p>
                    <input 
                      type="file" 
                      accept=".pdf,.docx,.doc,.txt,.xlsx,.xls" 
                      onChange={(e) => setUploadFile(e.target.files[0])} 
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                    />
                    {uploadFile && <p className="mt-4 inline-block bg-white px-4 py-2 rounded-lg text-orange-600 font-bold border border-orange-200 shadow-sm">Обрано: {uploadFile.name}</p>}
                  </div>

                  <div className="mb-8">
                    <label className="block text-sm font-bold text-gray-700 mb-3 uppercase tracking-wide">Гриф обмеження доступу <span className="text-red-500">*</span></label>
                    <select 
                      value={accessLevel} 
                      onChange={(e) => setAccessLevel(e.target.value)} 
                      className="bg-white border-2 border-gray-200 text-gray-900 font-medium rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full p-4"
                    >
                      <option value="">-- Оберіть рівень секретності --</option>
                      <option value="Public">Відкрита інформація</option>
                      <option value="DSP">ДСК (Для службового користування)</option>
                      <option value="Secret">Таємно</option>
                    </select>
                  </div>

                  <button 
                    onClick={handleUpload} 
                    disabled={!uploadFile || !accessLevel || isProcessing} 
                    className="w-full bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white font-bold py-4 px-5 rounded-lg transition-colors shadow-sm text-lg uppercase tracking-wide flex justify-center items-center gap-3"
                  >
                    {isProcessing ? 'Обробка...' : <><span>🧠</span> Аналізувати через Ollama</>}
                  </button>

                  {uploadStatus && !isProcessing && !showVerification && (
                    <div className={`mt-6 p-4 rounded-lg text-sm font-bold ${uploadStatus.includes('failed') || uploadStatus.includes('Помилка') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
                      {uploadStatus}
                    </div>
                  )}

                  {showVerification && (
                    <div className="mt-8 bg-white p-6 rounded-xl shadow-sm border border-orange-200 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-orange-400"></div>
                      <h2 className="text-xl font-bold text-gray-800 mb-6">Перевірка та редагування термінів від AI</h2>
                      
                      <div className="space-y-4 mb-6 max-h-96 overflow-y-auto pr-2">
                        {pendingTerms.length > 0 ? (
                          pendingTerms.map((term, index) => (
                            <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex gap-4">
                              <div className="flex-1 space-y-3">
                                <input
                                  type="text"
                                  value={term.term}
                                  onChange={(e) => handlePendingTermChange(index, 'term', e.target.value)}
                                  className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border bg-white font-medium"
                                  placeholder="Назва терміну"
                                />
                                <select
                                  value={term.category}
                                  onChange={(e) => handlePendingTermChange(index, 'category', e.target.value)}
                                  className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border bg-white font-medium text-gray-700"
                                >
                                  {categories.map(c => <option key={c.title} value={c.title}>{c.title}</option>)}
                                </select>
                                <textarea
                                  value={term.definition}
                                  onChange={(e) => handlePendingTermChange(index, 'definition', e.target.value)}
                                  rows="2"
                                  className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border bg-white"
                                  placeholder="Визначення"
                                />
                              </div>
                              <button 
                                onClick={() => handleDeletePendingTerm(index)} 
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-md h-fit transition-colors"
                                title="Видалити термін"
                              >
                                🗑️
                              </button>
                            </div>
                          ))
                        ) : <p className="text-gray-500 italic">ШІ не знайшов термінів для перевірки.</p>}
                      </div>
                      
                      <div className="flex gap-3">
                        <button onClick={confirmTerms} disabled={pendingTerms.length === 0} className="bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-6 rounded-lg transition-colors shadow-sm">
                          Підтвердити та додати в базу
                        </button>
                        <button onClick={() => setShowVerification(false)} className="bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-6 rounded-lg transition-colors">
                          Скасувати
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === 'admin' ? (
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold text-gray-800">Матриця доступів користувачів</h2>
                    <button className="bg-gray-800 hover:bg-gray-900 text-white font-medium py-2 px-4 rounded-lg transition-colors shadow-sm">
                      + Додати користувача
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                          <th className="p-4 font-semibold rounded-tl-lg">Користувач</th>
                          <th className="p-4 font-semibold">Роль</th>
                          <th className="p-4 font-semibold">Гриф доступу</th>
                          <th className="p-4 font-semibold">Статус</th>
                          <th className="p-4 font-semibold rounded-tr-lg text-right">Дії</th>
                        </tr>
                      </thead>
                      <tbody className="text-sm divide-y divide-gray-100">
                        {users.map(user => (
                          <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                            <td className="p-4 font-bold text-gray-900">{user.name}</td>
                            <td className="p-4 text-gray-600 font-medium">{user.role}</td>
                            <td className="p-4">
                              <select 
                                className="bg-white border border-gray-300 text-gray-900 text-xs font-semibold rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 w-full max-w-[200px]"
                                defaultValue={user.clearance}
                              >
                                <option value="Public">Відкрита інформація</option>
                                <option value="DSP">ДСК (Службове)</option>
                                <option value="Secret">Таємно (Secret)</option>
                              </select>
                            </td>
                            <td className="p-4">
                              <span className={`px-2.5 py-1 rounded-md text-xs font-bold border tracking-wide uppercase ${user.status === 'Активний' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-yellow-50 text-yellow-700 border-yellow-200'}`}>
                                {user.status}
                              </span>
                            </td>
                            <td className="p-4 text-right">
                              <button className="text-gray-400 hover:text-orange-600 transition-colors font-medium">
                                Налаштувати ⚙️
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </main>

          {/* Slide-over Панель: Деталі Терміна */}
          <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${selectedTerm ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setSelectedTerm(null)} />
          </div>

          <div className={`fixed inset-y-0 right-0 z-50 w-full max-w-2xl bg-white shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col border-l border-gray-200 ${selectedTerm ? 'translate-x-0' : 'translate-x-full'}`}>
            {selectedTerm && (
              <>
                <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
                  <div className="flex items-center gap-4">
                    <button onClick={() => setSelectedTerm(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500" title="Закрити панель">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                    <div className="flex gap-2">
                      <span className={`px-3 py-1 rounded-md text-[10px] font-black border tracking-wider uppercase ${getSecurityBg(selectedTerm.security_stamp)}`}>
                        {getSecurityLabel(selectedTerm.security_stamp)}
                      </span>
                      <span className="px-3 py-1 rounded-md text-[10px] font-black border tracking-wider uppercase bg-gray-100 text-gray-600 border-gray-200">
                        {selectedTerm.category || 'Без категорії'}
                      </span>
                    </div>
                  </div>
                  <button onClick={() => toggleFavorite(selectedTerm)} className={`text-3xl transition-all focus:outline-none ${favorites.some(t => t.id === selectedTerm.id) ? 'text-yellow-400 hover:text-yellow-500 scale-110' : 'text-gray-300 hover:text-gray-400 hover:scale-110'} active:scale-95`} title="Додати до обраного">
                    {favorites.some(t => t.id === selectedTerm.id) ? '★' : '☆'}
                  </button>
                </div>

                <div className="p-10 overflow-y-auto flex-1">
                  <h1 className="text-4xl font-black text-gray-900 mb-8 uppercase tracking-tight">{selectedTerm.term_name}</h1>
                  
                  <div className="prose prose-orange prose-lg max-w-none mb-10">
                    <div className="bg-orange-50/50 border-l-4 border-orange-500 p-6 rounded-r-xl">
                      <p className="text-gray-800 leading-relaxed font-medium m-0">{selectedTerm.definition}</p>
                    </div>
                  </div>

                  <div className="border-t border-gray-100 pt-8 mt-auto">
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-4">Джерело документа</h3>
                    <button onClick={() => openSource(selectedTerm)} className="w-full bg-gray-900 hover:bg-black text-white font-bold py-4 px-6 rounded-xl transition-all shadow-sm flex justify-between items-center group">
                      <span className="flex items-center gap-3"><span className="text-2xl">📄</span> Відкрити оригінальний документ</span>
                      <span className="bg-gray-800 text-gray-300 px-2 py-1 rounded text-xs uppercase border border-gray-700 group-hover:bg-gray-700 transition-colors">.{selectedTerm.file_type}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

        </div>
  )
}

export default App
