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

  const handleSearch = async () => {
    try {
      console.log(`[Frontend] Виконання базового пошуку за запитом: "${searchQuery}"`);
      const response = await fetch(`http://localhost:3001/search?q=${searchQuery}`)
      const data = await response.json()
      console.log(`[Frontend] Результати пошуку: знайдено ${data.length} збігів.`);
      setTerms(data)
    } catch (error) {
      console.error('Search failed:', error)
    }
  }

  const handleSemanticSearch = async () => {
    try {
      console.log(`[Frontend] Виконання семантичного пошуку за запитом: "${searchQuery}"`);
      const response = await fetch(`http://localhost:3001/semantic-search?q=${searchQuery}`)
      const data = await response.json()
      setTerms(data.map(item => ({
        id: item.termId,
        term_name: item.termName,
        definition: item.definition || item.content?.split(': ')[1] || item.content,
        source_id: item.source_id,
        file_type: item.file_type
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
        setPendingTerms(result.pendingTerms)
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

  const openSource = (sourceId) => {
    console.log(`[Frontend] Відкриття джерела документа ID: ${sourceId}`);
    window.open(`http://localhost:3001/source/${sourceId}`, '_blank')
  }

  const categories = [
    { title: 'Системи зв’язку', icon: '📡', count: 450, color: 'border-l-orange-500' },
    { title: 'Кібербезпека', icon: '🛡️', count: 320, color: 'border-l-blue-500' },
    { title: 'Криптографія', icon: '🔑', count: 120, color: 'border-l-red-500' },
    { title: 'Нормативна база', icon: '📜', count: 85, color: 'border-l-green-500' },
    { title: 'РЕБ / РЕР', icon: '📻', count: 210, color: 'border-l-yellow-500' },
    { title: 'IT-термінологія', icon: '💻', count: 180, color: 'border-l-purple-500' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans">
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
            <span className="text-orange-500 text-2xl">🛡️</span> ІДС Термінів
          </h1>
        </div>
        <nav className="flex-1 px-4 space-y-2 mt-4">
          <a href="#" className="flex items-center gap-3 bg-orange-500/10 text-orange-500 px-4 py-3 rounded-lg font-medium border border-orange-500/20 transition-all">
            <span className="text-lg">📚</span> Каталог термінів
          </a>
          <a href="#" className="flex items-center gap-3 hover:bg-gray-800 hover:text-white px-4 py-3 rounded-lg transition-colors">
            <span className="text-lg">☁️</span> Завантаження
          </a>
          <a href="#" className="flex items-center gap-3 hover:bg-gray-800 hover:text-white px-4 py-3 rounded-lg transition-colors">
            <span className="text-lg">⏳</span> Архів (Застаріле)
          </a>
        </nav>
        <div className="p-4 border-t border-gray-800">
          <a href="#" className="flex items-center gap-3 hover:bg-gray-800 hover:text-white px-4 py-3 rounded-lg transition-colors">
            <span className="text-lg">❓</span> Довідка
          </a>
        </div>
      </aside>

      {/* Головна робоча зона */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        
        {/* Верхня панель (Header) */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center shadow-sm z-0">
          <h2 className="text-xl font-semibold text-gray-800">Каталог термінів</h2>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900">Михайло Кльоц</p>
              <p className="text-xs text-gray-500">Адміністратор</p>
            </div>
            <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold border border-orange-200 cursor-pointer shadow-sm hover:bg-orange-200 transition-colors">
              МК
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          
          {/* Банер привітання та статистика */}
          <div className="bg-orange-50 border-l-4 border-orange-500 p-6 rounded-xl shadow-sm mb-8">
            <h2 className="text-2xl font-bold text-gray-800">Вітаємо, Михайле! Який термін шукаємо сьогодні?</h2>
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white px-5 py-4 rounded-lg shadow-sm border border-orange-100">
                <p className="text-sm text-gray-500 mb-1 font-medium">Всього термінів</p>
                <p className="text-3xl font-bold text-gray-800">1,240</p>
              </div>
              <div className="bg-white px-5 py-4 rounded-lg shadow-sm border border-orange-100">
                <p className="text-sm text-gray-500 mb-1 font-medium">Завантажено документів</p>
                <p className="text-3xl font-bold text-gray-800">84</p>
              </div>
              <div className="bg-white px-5 py-4 rounded-lg shadow-sm border border-orange-100">
                <p className="text-sm text-gray-500 mb-1 font-medium">Актуальність бази</p>
                <p className="text-3xl font-bold text-green-600">98%</p>
              </div>
            </div>
          </div>

          {/* Плитки категорій */}
          <div className="mb-10">
            <h3 className="text-xl font-bold text-gray-800 mb-5">Специфікації знань</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {categories.map((cat) => (
                <div key={cat.title} className={`bg-white p-6 rounded-xl shadow-sm border-l-4 border border-y-gray-100 border-r-gray-100 ${cat.color} hover:shadow-md hover:-translate-y-1 transition-all cursor-pointer group`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-bold text-gray-800 group-hover:text-orange-600 transition-colors">{cat.title}</h4>
                      <p className="text-sm text-gray-500 mt-1">{cat.count} термінів</p>
                    </div>
                    <span className="text-4xl opacity-80 group-hover:opacity-100 transition-opacity">{cat.icon}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Секція завантаження */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>➕</span> Завантажити новий документ</h3>
            <div className="flex flex-wrap items-center gap-4">
              <input 
                type="file" 
                accept=".pdf,.docx,.doc" 
                onChange={(e) => setUploadFile(e.target.files[0])} 
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-orange-50 file:text-orange-700 hover:file:bg-orange-100 border border-gray-200 rounded-lg cursor-pointer max-w-sm" 
              />
              <select 
                value={accessLevel} 
                onChange={(e) => setAccessLevel(e.target.value)} 
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2.5"
              >
                <option value="">Оберіть гриф обмеження</option>
                <option value="Public">Відкрита інформація</option>
                <option value="DSP">ДСК (Службове користування)</option>
                <option value="Secret">Таємно</option>
              </select>
              <button 
                onClick={handleUpload} 
                disabled={!uploadFile || !accessLevel || isProcessing} 
                className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-medium py-2.5 px-5 rounded-lg transition-colors shadow-sm"
              >
                Обробити ШІ
              </button>
            </div>
            {uploadStatus && !isProcessing && <div className="mt-4 p-3 bg-blue-50 text-blue-800 border border-blue-200 rounded-lg text-sm">{uploadStatus}</div>}
          </div>

      {showVerification && (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-orange-200 mb-8 relative overflow-hidden">
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

          {/* Секція пошуку */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 mb-8">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><span>🔍</span> Пошук по базі</h3>
            <div className="flex flex-wrap gap-3">
              <input
                type="text"
                placeholder="Введіть запит (наприклад: 'шифрування')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full max-w-md p-2.5"
              />
              <button onClick={handleSearch} className="bg-gray-800 hover:bg-gray-900 text-white font-medium py-2.5 px-5 rounded-lg transition-colors">
                Пошук за словом
              </button>
              <button onClick={handleSemanticSearch} className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2.5 px-5 rounded-lg transition-colors shadow-sm flex items-center gap-2">
                <span>✨</span> AI Семантичний пошук
              </button>
              <button onClick={fetchTerms} className="bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 font-medium py-2.5 px-5 rounded-lg transition-colors ml-auto">
                Скинути
              </button>
            </div>
          </div>

          {/* Список термінів */}
          <div className="mb-8">
            <div className="flex justify-between items-end mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Результати ({terms.length})</h2>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {terms.map(term => (
                <div key={term.id} className={`p-6 border rounded-xl shadow-sm transition-shadow hover:shadow-md ${term.is_actual ? 'border-gray-200 bg-white' : 'border-gray-300 bg-gray-50'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <h3 className={`text-lg font-bold leading-tight ${term.is_actual ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                      {term.term_name.toUpperCase()}
                      {!term.is_actual && <span className="text-sm font-normal text-gray-400 ml-2 block sm:inline mt-1 sm:mt-0">(Застаріле)</span>}
                    </h3>
                    <span className={`shrink-0 ml-4 px-2.5 py-1 rounded-md text-xs font-bold border tracking-wide uppercase ${term.is_actual ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {term.is_actual ? 'Актуально' : 'Застаріло'}
                    </span>
                  </div>
                  <p className={`text-sm mb-5 line-clamp-4 hover:line-clamp-none ${term.is_actual ? 'text-gray-700' : 'text-gray-500'}`}>
                    {term.definition}
                  </p>
                  <div className="flex items-center justify-between border-t border-gray-100 pt-4 text-sm mt-auto">
                    <button onClick={() => openSource(term.source_id)} className="flex items-center gap-2 text-orange-600 hover:text-orange-800 hover:underline font-medium transition-colors">
                      <span>📄</span> Відкрити джерело 
                      <span className="uppercase text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">.{term.file_type}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
        </div>
      </main>
    </div>
  )
}

export default App
