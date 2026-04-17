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
  const [uploadProgress, setUploadProgress] = useState(0) // Відсоток (0-100)
  const [uploadStatusText, setUploadStatusText] = useState('') // Динамічний текст етапу
  const [uploadStatus, setUploadStatus] = useState('')
  const [uploadError, setUploadError] = useState(null) // Стан для помилок під час завантаження
  const [activeTab, setActiveTab] = useState('dashboard') // 'dashboard' або 'admin'
  const [adminTab, setAdminTab] = useState('users') // 'users' або 'terms'
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [selectedTerm, setSelectedTerm] = useState(null) // Стан для Slide-over панелі
  const [editingTerm, setEditingTerm] = useState(null) // Стан для редагування терміну в Адмін-панелі
  const [favorites, setFavorites] = useState([]) // Стан для збереження обраних термінів
  const [history, setHistory] = useState([]) // Стан для збереження історії переглядів
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false) // Стан для мобільного меню

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
      const response = await fetch('/api/terms')
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
      const response = await fetch(`/api/search?q=${query}`)
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
      const response = await fetch(`/api/semantic-search?q=${searchQuery}`)
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
    
    // Унікальний ідентифікатор для відстеження прогресу через SSE
    const taskId = Date.now().toString();
    formData.append('taskId', taskId);

    let eventSource = null;
    let pseudoProgressInterval = null;

    try {
      console.log(`[Frontend] Початок завантаження файлу: ${uploadFile.name}, рівень доступу: ${accessLevel}`);
      setIsProcessing(true)
      setUploadProgress(0)
      setUploadStatusText('Підготовка до відправки...')
      setUploadError(null)
      setUploadStatus('Uploading document...')

      // Підключаємося до стріму прогресу
      eventSource = new EventSource(`/api/progress/${taskId}`);
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setUploadProgress(data.progress);
        setUploadStatusText(data.message);
      };

      // ДАЄМО 500мс на встановлення SSE-з'єднання ПЕРЕД відправкою важкого файлу
      await new Promise(resolve => setTimeout(resolve, 500));

      // "Псевдо-прогрес": ШІ працює довго, тому щоб смуга не висіла на 30%, вона буде повільно повзти сама
      pseudoProgressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 30 && prev < 90) return prev + 0.5;
          return prev;
        });
      }, 1000);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      })
      
      // Перевіряємо, чи сервер повернув саме JSON, а не HTML сторінку з помилкою (наприклад від Nginx 413/502)
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        throw new Error(`Сервер повернув некоректну відповідь (Статус: ${response.status}). Можливо, файл занадто великий або бекенд недоступний.`);
      }

      const result = await response.json()

      if (!response.ok) {
        console.error('[Frontend] Помилка завантаження файлу:', result);
        setUploadStatus(result.error || result.message || 'Upload failed. Please try again.')
        setUploadError(`Помилка сервера: ${result.error || result.message}`)
        return
      }

      if (result.pendingTerms) {
        console.log(`[Frontend] AI проаналізував файл. Очікується підтвердження ${result.pendingTerms.length} термінів.`);
        let termsToVerify = result.pendingTerms.map(t => ({ ...t, category: t.category || 'IT-термінологія', extended_info: t.extended_info || '', definition_source_type: 'Document', uncertain: t.uncertain || false }));
        
        // Сортуємо: проблемні терміни (без опису або з коротким) піднімаємо нагору
        termsToVerify.sort((a, b) => {
          const aProblem = !a.definition || a.definition.length < 10 || a.definition === 'Опис відсутній' || a.uncertain;
          const bProblem = !b.definition || b.definition.length < 10 || b.definition === 'Опис відсутній' || b.uncertain;
          if (aProblem && !bProblem) return -1;
          if (!aProblem && bProblem) return 1;
          return 0;
        });

        setPendingTerms(termsToVerify);
        // Автоматично генеруємо опис для термінів, де він відсутній
        termsToVerify.forEach((term, index) => {
          if (!term.definition || term.definition.length < 10 || term.definition === 'Опис відсутній') {
            handleGenerateDefinition(index, true); // true означає, що це автоматичний виклик
          }
        });
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
      setUploadError(`Збій з'єднання: ${error.message}`)
    } finally {
      if (eventSource) eventSource.close(); // Закриваємо з'єднання SSE
      if (pseudoProgressInterval) clearInterval(pseudoProgressInterval);
      if (!uploadError) setIsProcessing(false); // Не закриваємо вікно автоматично, якщо є помилка, щоб користувач її прочитав
    }
  }

  const confirmTerms = async () => {
    try {
      console.log(`[Frontend] Підтвердження та відправка ${pendingTerms.length} термінів до БД...`);
      await fetch('/api/confirm-terms', {
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

  const handleGenerateDefinition = async (index, isAuto = false) => {
    const termToUpdate = pendingTerms[index];
    if (!termToUpdate) return;

    // Позначаємо, що для цього терміну йде генерація
    handlePendingTermChange(index, 'is_generating', true);

    try {
      const response = await fetch('/api/generate-definition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termName: termToUpdate.term })
      });
      const data = await response.json();

      const updatedTerms = [...pendingTerms];
      updatedTerms[index].definition = data.definition;
      updatedTerms[index].extended_info = data.extended_info;
      updatedTerms[index].definition_source_type = 'AI-Generated';
      updatedTerms[index].is_generating = false;
      setPendingTerms(updatedTerms);
    } catch (error) {
      console.error('Failed to generate AI definition:', error);
      handlePendingTermChange(index, 'is_generating', false);
    }
  };

  const handleUpdateTerm = async (e) => {
    e.preventDefault()
    try {
      const response = await fetch(`/api/terms/${editingTerm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTerm)
      })
      if (response.ok) {
        setEditingTerm(null)
        fetchTerms() // Оновлює список та перераховує аналітику на плитках
      }
    } catch (error) {
      console.error('Failed to update term:', error)
    }
  }

  const handleDeleteTerm = async (id) => {
    if (!window.confirm('Ви впевнені, що хочете безповоротно видалити цей термін з бази даних?')) return;
    try {
      const response = await fetch(`/api/terms/${id}`, { method: 'DELETE' })
      if (response.ok) fetchTerms() // Оновлює аналітику
    } catch (error) {
      console.error('Failed to delete term:', error)
    }
  }

  const openSource = (term) => {
    console.log(`[Frontend] Відкриття джерела документа ID: ${term.source_id}`);
    window.open(`/api/source/${term.source_id}`, '_blank')
  }

  const openTermDetails = (term) => {
    setSelectedTerm(term);
    addToHistory(term.term_name, 'Перегляд'); // Записуємо перегляд в історію при відкритті панелі
  }

  const openCategory = async (category) => {
    setSelectedCategory(category);
    setActiveTab('category');
    try {
      const response = await fetch(`/api/terms?category=${encodeURIComponent(category.title)}`)
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

  // Динамічний підрахунок глобальної статистики
  const globalTotal = terms.length;
  const globalActual = terms.filter(t => t.is_actual).length;
  const globalActualPercentage = globalTotal > 0 ? Math.round((globalActual / globalTotal) * 100) : 0;

  // Динамічний підрахунок статистики для кожної плитки-категорії
  const getCategoryStats = (catTitle) => {
    const catTerms = terms.filter(t => (t.category || 'IT-термінологія') === catTitle);
    const total = catTerms.length;
    const actual = catTerms.filter(t => t.is_actual).length;
    const actualPercentage = total > 0 ? Math.round((actual / total) * 100) : 0;
    const secret = catTerms.filter(t => t.security_stamp === 'Secret').length;
    const dsp = catTerms.filter(t => t.security_stamp === 'DSP').length;
    const publicCount = catTerms.filter(t => t.security_stamp === 'Public').length;
    return { total, actualPercentage, secret, dsp, publicCount };
  };

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex font-sans">
      {isProcessing && (
        <div className="fixed inset-0 bg-gray-900/60 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-white p-5 sm:p-8 rounded-2xl shadow-xl w-full max-w-[500px] mx-4 relative overflow-hidden flex flex-col max-h-[90vh] overflow-y-auto">
            
            {/* Шапка з іконкою */}
            <div className="flex items-center gap-4 mb-8">
              <div className="w-14 h-14 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center text-xl font-black border border-orange-100 shadow-sm">
                {uploadFile?.name?.toLowerCase().endsWith('.pdf') ? 'PDF' : 'DOC'}
              </div>
              <div className="flex-1 overflow-hidden">
                <h3 className="text-xl font-bold text-gray-900 uppercase tracking-tight">Обробка документа</h3>
                <p className="text-sm text-gray-500 truncate font-medium">{uploadFile?.name}</p>
              </div>
            </div>
            
            {/* Крокувальник (Stepper) */}
            <div className="flex justify-between mb-8 relative px-2">
              <div className="absolute top-4 left-0 w-full h-1 bg-gray-100 -z-10"></div>
              <div className="absolute top-4 left-0 h-1 bg-orange-500 -z-10 transition-all duration-500" style={{ width: `${uploadProgress}%` }}></div>
              
              <div className={`flex flex-col items-center gap-2 bg-white px-2 ${uploadProgress >= 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${uploadProgress >= 0 ? 'border-orange-500 bg-orange-50' : 'border-gray-200 bg-white'}`}>1</div>
                <span className="text-[10px] font-bold uppercase tracking-wider">Завантаження</span>
              </div>
              <div className={`flex flex-col items-center gap-2 bg-white px-2 ${uploadProgress >= 10 ? 'text-orange-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${uploadProgress >= 10 ? (uploadProgress < 30 ? 'border-orange-500 bg-orange-50 animate-pulse' : 'border-orange-500 bg-orange-50') : 'border-gray-200 bg-white'}`}>2</div>
                <span className="text-[10px] font-bold uppercase tracking-wider">Аналіз тексту</span>
              </div>
              <div className={`flex flex-col items-center gap-2 bg-white px-2 ${uploadProgress >= 30 ? 'text-orange-600' : 'text-gray-400'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2 transition-colors ${uploadProgress >= 30 ? (uploadProgress < 100 ? 'border-orange-500 bg-orange-50 animate-pulse' : 'border-orange-500 bg-orange-50') : 'border-gray-200 bg-white'}`}>3</div>
                <span className="text-[10px] font-bold uppercase tracking-wider">Робота ШІ</span>
              </div>
            </div>
            
            {/* Смуга прогресу */}
            <div className="w-full bg-gray-100 rounded-full h-3 mb-3 overflow-hidden border border-gray-200 shadow-inner">
              <div 
                className="bg-orange-500 h-full transition-all duration-300 ease-out relative"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            
            <div className="flex justify-between items-end mb-2">
              <p className={`text-sm font-bold ${uploadError ? 'text-red-600' : 'text-gray-800 animate-pulse'}`}>{uploadError ? 'Помилка опрацювання' : (uploadStatusText || 'Ініціалізація...')}</p>
              <p className="text-xs text-gray-500 font-black">{Math.round(uploadProgress)}%</p>
            </div>
            
            {/* Відображення помилки */}
            {uploadError && (
               <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
                 <p className="text-xs font-bold text-red-800 uppercase tracking-wider mb-1">Деталі помилки:</p>
                 <p className="text-sm text-red-600 font-medium mb-4">{uploadError}</p>
                 <button onClick={() => { setIsProcessing(false); setUploadError(null); }} className="w-full bg-white border border-red-200 hover:bg-red-100 text-red-700 font-bold py-2 rounded-lg transition-colors shadow-sm">Закрити вікно</button>
               </div>
            )}
            
            {/* Дисклеймер (ховається при помилці) */}
            {!uploadError && (
              <div className="mt-6 pt-5 border-t border-gray-100 bg-gray-50 -mx-5 -mb-5 p-5 sm:-mx-8 sm:-mb-8 sm:p-8 text-left rounded-b-2xl">
                <p className="text-xs text-gray-500 font-medium flex gap-3 leading-relaxed">
                  <span className="text-xl">⏳</span>
                  Оскільки система використовує локальний ШІ (Ollama) для максимальної безпеки даних, обробка великих документів може тривати до кількох хвилин.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Backdrop для мобільного меню */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-gray-900/60 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}

      {/* Бокова панель (Sidebar) */}
      <aside className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 w-72 md:w-64 bg-gray-900 text-gray-300 flex-shrink-0 flex flex-col shadow-2xl md:shadow-xl z-50 transition-transform duration-300 ease-in-out`}>
        <div className="p-6 flex justify-between items-center">
          <h1 className="text-white text-xl font-bold flex items-center gap-3 truncate">
            <span className="text-orange-500 text-2xl">🛡️</span> ІДС "Глосарій-КБ"
          </h1>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto pb-4">
          <nav className="px-4 space-y-1 mb-8">
            <a href="#" onClick={() => { setActiveTab('dashboard'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'dashboard' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">🏠</span> Головна
            </a>
            <a href="#" onClick={() => { setActiveTab('my-terms'); fetchTerms(); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'my-terms' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">👤</span> Мої терміни
            </a>
            <a href="#" onClick={() => { setActiveTab('favorites'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'favorites' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">⭐</span> Обране
            </a>
            <a href="#" onClick={() => { setActiveTab('history'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'history' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">🕒</span> Історія переглядів
            </a>
          </nav>
        </div>

        <div className="p-4 border-t border-gray-800 space-y-1">
          <a href="#" onClick={() => { setActiveTab('upload'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'upload' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
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
        <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4 flex justify-between items-center shadow-sm z-0 gap-2 sm:gap-4">
              <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden text-gray-600 hover:text-orange-500 transition-colors">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
              </button>
              <div className="flex-1 max-w-2xl flex items-center gap-2 pr-2 sm:pr-8">
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">🔍</span>
                  <input
                    type="text"
                    placeholder="Пошук..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                    className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full pl-10 p-2.5"
                  />
                </div>
                <button onClick={() => handleSearch(searchQuery)} className="hidden lg:block bg-gray-800 hover:bg-gray-900 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">Знайти</button>
                <button onClick={handleSemanticSearch} className="hidden md:block bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors" title="AI Семантичний пошук">✨ AI</button>
                {(terms.length > 0 || searchQuery) && (
                  <button onClick={() => { setSearchQuery(''); setActiveTab('dashboard'); fetchTerms(); }} className="text-gray-500 hover:text-red-500 px-2 text-sm font-medium transition-colors">Скинути</button>
                )}
              </div>
              <div className="flex items-center gap-3 sm:gap-4 border-l border-gray-200 pl-3 sm:pl-6">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-bold text-gray-800 cursor-pointer hover:text-orange-600 flex items-center gap-1" onClick={() => setActiveTab('admin')}>
                    Михайло Кльоц <span className="text-xs">▼</span>
                  </p>
                  <p className="text-xs text-gray-500">Адміністратор</p>
                </div>
                <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold border border-orange-200 shadow-sm cursor-pointer hover:bg-orange-200 transition-colors text-sm sm:text-base" onClick={() => setActiveTab('admin')}>
                  МК
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-auto p-4 sm:p-8 bg-gray-50">
              {activeTab === 'dashboard' ? (
                <>
                  {/* Банер привітання та статистика */}
                  <div className="bg-white border-l-4 border-orange-500 p-5 sm:p-6 rounded-xl shadow-sm mb-6 sm:mb-8 border-y border-r border-gray-200">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">ВІТАЄМО, МИХАЙЛЕ!</h2>
                    <div className="mt-4 sm:mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-blue-500 w-full"></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Всього в БД</p>
                        <p className="text-3xl sm:text-4xl font-black text-gray-800">{globalTotal}</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-green-500 transition-all duration-1000" style={{ width: `${globalActualPercentage}%` }}></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Актуальність</p>
                        <p className="text-3xl sm:text-4xl font-black text-green-600">{globalActualPercentage}%</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-orange-500 w-[15%]"></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Опрацьовано ШІ</p>
                        <p className="text-3xl sm:text-4xl font-black text-orange-600">210</p>
                      </div>
                    </div>
                  </div>

                  {/* Плитки категорій */}
                  <div className="mb-6 sm:mb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {categories.map((cat) => {
                        const stats = getCategoryStats(cat.title);
                        return (
                          <div key={cat.title} onClick={() => openCategory(cat)} className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between hover:shadow-xl hover:border-orange-200 hover:-translate-y-1.5 transition-all cursor-pointer min-h-[220px] group ${cat.colSpan}`}>
                            <div>
                              <div className="flex justify-between items-start mb-4 relative">
                                <h3 className="text-xl font-black text-gray-800 group-hover:text-orange-600 transition-colors uppercase tracking-tight flex items-center gap-2">
                                  <span>{cat.icon}</span> {cat.title}
                                </h3>
                                <button onClick={(e) => { e.stopPropagation(); fetchTerms(); }} className="text-gray-300 hover:text-orange-500 transition-colors bg-white rounded-full p-1 shadow-sm border border-gray-100" title="Оновити дані">🔄</button>
                              </div>
                              <div className="grid grid-cols-2 gap-4 border-t border-b border-gray-100 py-4">
                                <div>
                                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Усього термінів</p>
                                  <p className="text-xl sm:text-2xl font-black text-gray-800">{stats.total}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Актуальність</p>
                                  <div className="flex items-center gap-2">
                                    <p className={`text-xl sm:text-2xl font-black ${stats.actualPercentage >= 90 ? 'text-green-600' : 'text-orange-500'}`}>{stats.actualPercentage}%</p>
                                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                                      <div className={`h-1.5 rounded-full transition-all duration-1000 ${stats.actualPercentage >= 90 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${stats.actualPercentage}%` }}></div>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between text-[10px] sm:text-xs font-bold text-gray-500 gap-2 sm:gap-0">
                              <div className="flex flex-wrap gap-2 sm:gap-3">
                                <span className="flex items-center gap-1" title="Відкрита інформація"><span className="w-2 h-2 rounded-full bg-green-500"></span> В: {stats.publicCount}</span>
                                <span className="flex items-center gap-1" title="Для службового користування"><span className="w-2 h-2 rounded-full bg-yellow-500"></span> ДСК: {stats.dsp}</span>
                                <span className="flex items-center gap-1" title="Таємно"><span className="w-2 h-2 rounded-full bg-red-500"></span> Т: {stats.secret}</span>
                              </div>
                              <span className="text-gray-400 group-hover:text-orange-500 transition-colors">Перейти →</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              {/* Списки термінів винесено в окремі вкладки */}
              {['category', 'search', 'my-terms', 'favorites'].includes(activeTab) && (
                <div className="bg-white p-4 sm:p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 border-b border-gray-100 pb-4 gap-4 sm:gap-0">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">
                        {activeTab === 'category' && selectedCategory ? `📁 Категорія: ${selectedCategory.title}` : 
                         activeTab === 'search' ? `🔍 Результати пошуку: ${searchQuery}` : 
                         activeTab === 'favorites' ? `⭐ Обрані терміни` :
                         '👤 Мої додані терміни'}
                      </h2>
                      <p className="text-sm text-gray-500 font-medium mt-1">Знайдено записів: {(activeTab === 'favorites' ? favorites : terms).length}</p>
                    </div>
                    <button onClick={() => { setActiveTab('dashboard'); setSearchQuery(''); }} className="w-full sm:w-auto justify-center bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2">
                      <span>←</span> На Головну
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {(activeTab === 'favorites' ? favorites : terms).map(term => (
                      <div key={term.id} className={`p-5 sm:p-6 border border-t-4 ${getSecurityColor(term.security_stamp)} rounded-xl shadow-sm transition-all hover:shadow-md flex flex-col relative overflow-hidden ${term.is_actual ? 'bg-white' : 'bg-gray-50'}`}>
                        <div className="flex items-start justify-between mb-4">
                          <div className="flex items-center">
                            <h3 onClick={() => openTermDetails(term)} className={`text-base sm:text-lg font-bold leading-tight cursor-pointer hover:text-orange-600 transition-colors ${term.is_actual ? 'text-gray-900' : 'text-gray-500 line-through'}`}>
                              {term.term_name.toUpperCase()}
                              {!term.is_actual && <span className="text-xs sm:text-sm font-normal text-gray-400 ml-2 block sm:inline mt-1 sm:mt-0">(Застаріле)</span>}
                            </h3>
                            <button onClick={() => toggleFavorite(term)} className={`ml-3 text-2xl transition-all focus:outline-none ${favorites.some(t => t.id === term.id) ? 'text-yellow-400 hover:text-yellow-500 scale-110' : 'text-gray-300 hover:text-gray-400 hover:scale-110'} active:scale-95`} title="Додати до обраного">
                              {favorites.some(t => t.id === term.id) ? '★' : '☆'}
                            </button>
                          </div>
                          <div className="flex flex-col items-end gap-2">
                            <span className={`shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[9px] sm:text-[10px] font-black border tracking-wider uppercase ${getSecurityBg(term.security_stamp)}`}>
                              {getSecurityLabel(term.security_stamp)}
                            </span>
                            <span className={`shrink-0 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-bold border tracking-wide uppercase ${term.is_actual ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-gray-200 text-gray-500 border-gray-300'}`}>
                              {term.is_actual ? 'Актуально' : 'Застаріло'}
                            </span>
                          </div>
                        </div>
                        <p className={`text-xs sm:text-sm mb-5 line-clamp-4 hover:line-clamp-none ${term.is_actual ? 'text-gray-700' : 'text-gray-500'}`}>
                          {term.definition}
                        </p>
                        <div className="flex items-center justify-between border-t border-gray-200 pt-4 text-xs sm:text-sm mt-auto">
                          <button onClick={() => openSource(term)} className="flex items-center gap-1.5 sm:gap-2 text-orange-600 hover:text-orange-800 hover:underline font-bold transition-colors">
                            <span>📄</span> Відкрити джерело 
                            <span className="uppercase text-[9px] sm:text-[10px] font-black text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded border border-gray-300">.{term.file_type}</span>
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
                <div className="bg-white p-4 sm:p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 border-b border-gray-100 pb-4 gap-4 sm:gap-0">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">🕒 Історія активності</h2>
                      <p className="text-sm text-gray-500 font-medium mt-1">Останні пошукові запити та перегляди</p>
                    </div>
                    <button onClick={() => setHistory([])} className="w-full sm:w-auto justify-center bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2 border border-red-200">
                      Очистити історію
                    </button>
                  </div>
                  
                  {history.length > 0 ? (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
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
                <div className="max-w-4xl mx-auto bg-white p-5 sm:p-10 rounded-xl shadow-sm border border-gray-200">
                  <h2 className="text-xl sm:text-2xl font-bold text-gray-800 mb-6 uppercase tracking-tight border-b border-gray-100 pb-4">Завантаження документа</h2>
                  
                  <div className="border-2 border-dashed border-orange-300 bg-orange-50/50 rounded-xl p-8 sm:p-12 text-center hover:bg-orange-50 transition-colors mb-8 relative">
                    <span className="text-5xl mb-4 block">📥</span>
                    <p className="text-gray-800 font-bold text-base sm:text-lg mb-2">Перетягніть PDF або DOCX сюди</p>
                    <p className="text-gray-500 text-xs sm:text-sm mb-4">Або натисніть для вибору файлу на комп'ютері</p>
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
                      className="bg-white border-2 border-gray-200 text-gray-900 font-medium rounded-lg focus:ring-orange-500 focus:border-orange-500 block w-full p-3 sm:p-4 text-sm sm:text-base"
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
                    className="w-full bg-gray-900 hover:bg-black disabled:bg-gray-300 text-white font-bold py-3 sm:py-4 px-5 rounded-lg transition-colors shadow-sm text-base sm:text-lg uppercase tracking-wide flex justify-center items-center gap-3"
                  >
                    {isProcessing ? 'Обробка...' : <><span>🧠</span> Аналізувати через Ollama</>}
                  </button>

                  {uploadStatus && !isProcessing && !showVerification && (
                    <div className={`mt-6 p-4 rounded-lg text-sm font-bold ${uploadStatus.includes('failed') || uploadStatus.includes('Помилка') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
                      {uploadStatus}
                    </div>
                  )}

                  {showVerification && (
                    <div className="mt-8 bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-orange-200 relative overflow-hidden">
                      <div className="absolute top-0 left-0 w-full h-1 bg-orange-400"></div>
                      <h2 className="text-lg sm:text-xl font-bold text-gray-800 mb-4 sm:mb-6">Перевірка та редагування термінів від AI</h2>
                      
                      <div className="space-y-4 mb-6 max-h-[60vh] sm:max-h-96 overflow-y-auto pr-1 sm:pr-2">
                        {pendingTerms.length > 0 ? (
                          pendingTerms.map((term, index) => (
                            <div key={index} className={`border rounded-lg p-4 flex gap-4 transition-colors ${term.uncertain ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex-1 space-y-3">
                                {term.uncertain && <div className="text-yellow-700 text-xs font-bold uppercase tracking-wider flex items-center gap-1 mb-1">⚠️ Потребує перевірки (Сумнівний термін)</div>}
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
                                <div className="relative">
                                  <textarea
                                    value={term.definition}
                                    onChange={(e) => handlePendingTermChange(index, 'definition', e.target.value)}
                                    rows="2"
                                    className={`block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border ${!term.definition || term.definition.length < 10 ? 'bg-red-50 border-red-300' : 'bg-white'}`}
                                    placeholder="Визначення відсутнє або занадто коротке..."
                                  />
                                  {term.definition_source_type === 'AI-Generated' && (
                                    <span className="absolute top-2 right-2 text-xs font-bold text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-md flex items-center gap-1">🪄 AI-Generated</span>
                                  )}
                                </div>

                                <div className="relative mt-2">
                                  <span className="absolute -top-2.5 left-3 bg-gray-50 px-1 text-[10px] font-black text-indigo-600 uppercase tracking-wider">✨ AI-Доповнення (Insights)</span>
                                  <textarea value={term.extended_info} onChange={(e) => handlePendingTermChange(index, 'extended_info', e.target.value)} rows="3" className="block w-full border-indigo-200 bg-indigo-50/30 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-3 pt-4 border font-medium text-gray-800" placeholder="Розширене пояснення від ШІ..."/>
                                </div>
                                <div className="flex justify-end">
                                  <button onClick={() => handleGenerateDefinition(index)} disabled={term.is_generating} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50">
                                    {term.is_generating ? <><div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div> Переписуємо...</> : <>✨ Оновити визначення</>}
                                  </button>
                                </div>
                                
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
                      
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button onClick={confirmTerms} disabled={pendingTerms.length === 0} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-6 rounded-lg transition-colors shadow-sm order-1 sm:order-none">
                          Підтвердити та додати в базу
                        </button>
                        <button onClick={() => setShowVerification(false)} className="w-full sm:w-auto bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-medium py-2.5 px-6 rounded-lg transition-colors">
                          Скасувати
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === 'admin' ? (
                <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-4 sm:gap-0">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">Панель Адміністратора</h2>
                    {adminTab === 'users' && (
                      <button className="w-full sm:w-auto bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-4 rounded-lg transition-colors shadow-sm text-sm">
                        + Додати користувача
                      </button>
                    )}
                  </div>

                  <div className="flex border-b border-gray-200 mb-6 gap-4 sm:gap-6 overflow-x-auto whitespace-nowrap pb-1">
                    <button onClick={() => setAdminTab('users')} className={`py-2 sm:py-3 font-bold text-xs sm:text-sm uppercase tracking-wider transition-colors ${adminTab === 'users' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500 hover:text-gray-800'}`}>Матриця доступів</button>
                    <button onClick={() => setAdminTab('terms')} className={`py-2 sm:py-3 font-bold text-xs sm:text-sm uppercase tracking-wider transition-colors ${adminTab === 'terms' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500 hover:text-gray-800'}`}>Керування термінами ({terms.length})</button>
                  </div>

                  {adminTab === 'users' ? (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
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
                  ) : (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                            <th className="p-4 font-semibold rounded-tl-lg">Термін</th>
                            <th className="p-4 font-semibold">Категорія</th>
                            <th className="p-4 font-semibold">Гриф</th>
                            <th className="p-4 font-semibold">Статус</th>
                            <th className="p-4 font-semibold rounded-tr-lg text-right">Дії</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-gray-100">
                          {terms.map(term => (
                            <tr key={term.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4 font-bold text-gray-900">{term.term_name}</td>
                              <td className="p-4 text-gray-600 font-medium">
                                <span className="bg-gray-100 px-2 py-1 rounded border border-gray-200 text-xs font-bold uppercase tracking-wider">{term.category || 'Без категорії'}</span>
                              </td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black border tracking-wider uppercase ${getSecurityBg(term.security_stamp)}`}>
                                  {getSecurityLabel(term.security_stamp)}
                                </span>
                              </td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-md text-xs font-bold border tracking-wide uppercase ${term.is_actual ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                                  {term.is_actual ? 'Актуально' : 'Застаріло'}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <div className="flex justify-end gap-2">
                                  <button onClick={() => setEditingTerm({...term})} className="text-indigo-600 hover:text-indigo-800 transition-colors font-bold bg-indigo-50 hover:bg-indigo-100 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm">✏️ Ред.</button>
                                  <button onClick={() => handleDeleteTerm(term.id)} className="text-red-500 hover:text-red-700 transition-colors font-bold bg-red-50 hover:bg-red-100 px-2 sm:px-3 py-1.5 rounded-md text-xs sm:text-sm">🗑️</button>
                                </div>
                               </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </main>

          {/* Slide-over Панель: Деталі Терміна */}
          <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${selectedTerm ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setSelectedTerm(null)} />
          </div>

          <div className={`fixed inset-y-0 right-0 z-50 w-full md:max-w-2xl bg-white shadow-2xl transform transition-transform duration-300 ease-in-out flex flex-col border-l border-gray-200 ${selectedTerm ? 'translate-x-0' : 'translate-x-full'}`}>
            {selectedTerm && (
              <>
                <div className="p-4 sm:p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/80">
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

                <div className="p-5 sm:p-10 overflow-y-auto flex-1">
                  <h1 className="text-2xl sm:text-4xl font-black text-gray-900 mb-6 sm:mb-8 uppercase tracking-tight">{selectedTerm.term_name}</h1>
                  
                  <div className="prose prose-orange prose-base sm:prose-lg max-w-none mb-8 sm:mb-10">
                    <div className="bg-orange-50/50 border-l-4 border-orange-500 p-4 sm:p-6 rounded-r-xl">
                      <p className="text-gray-800 leading-relaxed font-medium m-0 text-sm sm:text-base">{selectedTerm.definition}</p>
                    </div>
                    
                    {selectedTerm.extended_info && (
                      <div className="mt-6 sm:mt-8">
                        <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-2"><span>✨</span> Експертне доповнення</h3>
                        <p className="text-gray-700 leading-relaxed bg-indigo-50/50 border border-indigo-100 p-4 sm:p-6 rounded-xl shadow-sm text-sm sm:text-base">{selectedTerm.extended_info}</p>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 pt-6 sm:pt-8 mt-auto">
                    <h3 className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-4">Джерело документа</h3>
                    <button onClick={() => openSource(selectedTerm)} className="w-full bg-gray-900 hover:bg-black text-white font-bold py-3 sm:py-4 px-4 sm:px-6 rounded-xl transition-all shadow-sm flex justify-between items-center group text-sm sm:text-base">
                      <span className="flex items-center gap-2 sm:gap-3"><span className="text-xl sm:text-2xl">📄</span> Відкрити оригінальний документ</span>
                      <span className="bg-gray-800 text-gray-300 px-1.5 py-0.5 sm:px-2 sm:py-1 rounded text-[10px] sm:text-xs uppercase border border-gray-700 group-hover:bg-gray-700 transition-colors">.{selectedTerm.file_type}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Modal: Редагування терміну (Адмін) */}
          {editingTerm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-2 sm:p-4">
              <div className="bg-white p-5 sm:p-8 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] sm:max-h-[90vh] overflow-y-auto relative">
                <button onClick={() => setEditingTerm(null)} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-gray-400 hover:text-gray-700 text-3xl leading-none">&times;</button>
                <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-4 sm:mb-6 uppercase tracking-tight border-b border-gray-100 pb-4 pr-8">Редагування терміну</h2>
                
                <form onSubmit={handleUpdateTerm} className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Назва терміну</label>
                    <input type="text" value={editingTerm.term_name} onChange={(e) => setEditingTerm({...editingTerm, term_name: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-bold" required />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Розділ (Категорія)</label>
                      <select value={editingTerm.category || ''} onChange={(e) => setEditingTerm({...editingTerm, category: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium">
                        {categories.map(c => <option key={c.title} value={c.title}>{c.title}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Гриф секретності документа</label>
                      <select value={editingTerm.security_stamp || 'Public'} onChange={(e) => setEditingTerm({...editingTerm, security_stamp: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium">
                        <option value="Public">Відкрита інформація</option>
                        <option value="DSP">ДСК (Для службового користування)</option>
                        <option value="Secret">Таємно</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Академічне визначення</label>
                    <textarea value={editingTerm.definition || ''} onChange={(e) => setEditingTerm({...editingTerm, definition: e.target.value})} rows="4" className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3" required />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">✨ AI-Доповнення (Insights)</label>
                    <textarea value={editingTerm.extended_info || ''} onChange={(e) => setEditingTerm({...editingTerm, extended_info: e.target.value})} rows="4" className="w-full bg-indigo-50/30 border border-indigo-200 text-gray-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-3" />
                  </div>

                  <div className="flex items-center gap-3 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <input type="checkbox" id="is_actual" checked={editingTerm.is_actual} onChange={(e) => setEditingTerm({...editingTerm, is_actual: e.target.checked})} className="w-5 h-5 shrink-0 text-orange-500 bg-white border-gray-300 rounded focus:ring-orange-500 focus:ring-2 cursor-pointer" />
                    <label htmlFor="is_actual" className="font-bold text-gray-800 cursor-pointer select-none text-sm sm:text-base">Термін є актуальним (Відображається як робочий)</label>
                  </div>

                  <div className="flex flex-col sm:flex-row justify-end gap-3 pt-6 border-t border-gray-100">
                    <button type="button" onClick={() => setEditingTerm(null)} className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors order-1 sm:order-none">Скасувати</button>
                    <button type="submit" className="w-full sm:w-auto px-6 py-3 sm:py-2.5 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 transition-colors shadow-sm">💾 Зберегти зміни</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
  )
}

export default App
