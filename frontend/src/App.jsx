import { useState, useEffect } from 'react'
import './index.css'
import Login from './Login'
import { useAuth } from './useAuth.js'

function App() {
  const { user, accessToken, login, logout, authFetch, isInitialized } = useAuth();
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
  const [hideDuplicates, setHideDuplicates] = useState(true) // Стан для приховування дублікатів
  const [isAddingUser, setIsAddingUser] = useState(false) // Стан вікна "Додати користувача"
  const [newUser, setNewUser] = useState({ full_name: '', email: '@mitit.edu.ua', password: '', role: 'user', access_level: 'Public' })
  const [isProfileOpen, setIsProfileOpen] = useState(false) // Стан вікна профілю
  const [passwordData, setPasswordData] = useState({ oldPassword: '', newPassword: '' })
  const [adminSearchQuery, setAdminSearchQuery] = useState('') // Пошук у таблиці Адмінки
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('darkMode') === 'true'; }
    catch { return false; }
  });
  const [toast, setToast] = useState(null); // Стан для спливаючих повідомлень

  // Стан для статистики
  const [stats, setStats] = useState({});

  const [users, setUsers] = useState([])
  const [sources, setSources] = useState([])

  useEffect(() => {
    if (user) {
      fetchTerms()
      fetchStats()
      fetchFavorites()
      fetchHistory()
      if (user.role === 'admin') {
        fetchUsers()
        fetchSources()
      }
    }
  }, [user])

  // Управління Темною темою
  useEffect(() => {
    localStorage.setItem('darkMode', darkMode);
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  // Захист вкладок від прямого переходу
  useEffect(() => {
    if (activeTab === 'upload' && !['admin', 'operator'].includes(user?.role)) {
      setActiveTab('dashboard');
    }
    if (activeTab === 'admin' && user?.role !== 'admin') {
      setActiveTab('dashboard');
    }
  }, [activeTab, user]);

  // Функція виклику повідомлень
  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchStats = async () => {
    try {
      const response = await authFetch('/api/stats')
      if (!response.ok) throw new Error('Stats fetch failed');
      const data = await response.json()
      const map = {};
      data.forEach(row => { map[row.category] = row; });
      setStats(map);
    } catch (error) {
      console.error('Failed to fetch stats:', error)
    }
  }

  const fetchUsers = async () => {
    try {
      const response = await authFetch('/api/users')
      if (!response.ok) throw new Error('Users fetch failed');
      setUsers(await response.json())
    } catch (error) {
      console.error('Failed to fetch users:', error)
    }
  }

  const fetchSources = async () => {
    try {
      const response = await authFetch('/api/sources')
      if (!response.ok) throw new Error('Sources fetch failed');
      setSources(await response.json())
    } catch (error) {
      console.error('Failed to fetch sources:', error)
    }
  }

  const fetchFavorites = async () => {
    try {
      const response = await authFetch('/api/favorites');
      if (!response.ok) throw new Error('Favorites fetch failed');
      setFavorites(await response.json());
    } catch (e) { console.error('Failed to fetch favorites', e) }
  }

  const fetchHistory = async () => {
    try {
      const response = await authFetch('/api/history');
      if (!response.ok) throw new Error('History fetch failed');
      const data = await response.json();
      // Форматуємо час для красивого відображення
      setHistory(data.map(h => ({ ...h, time: new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })));
    } catch (e) { console.error('Failed to fetch history', e) }
  }

  const fetchTerms = async (page = 1, search = '') => {
    try {
      const response = await authFetch(`/api/terms?page=${page}&limit=50${search ? `&search=${encodeURIComponent(search)}` : ''}`)
      if (!response.ok) throw new Error('Terms fetch failed');
      const data = await response.json()
      setTerms(data.terms || data)
      if (data.totalPages) {
        setTotalPages(data.totalPages);
        setCurrentPage(data.page);
      }
    } catch (error) {
      console.error('Failed to fetch terms:', error)
    }
  }

  // Дебаунс: Серверний пошук в Адмін-панелі (по всій базі, а не лише 1 сторінці)
  useEffect(() => {
    if (activeTab === 'admin' && adminTab === 'terms' && user?.role === 'admin') {
      const timer = setTimeout(() => {
        fetchTerms(1, adminSearchQuery);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [adminSearchQuery, adminTab, activeTab, user]);

  const addToHistory = async (query, type = 'Пошук') => {
    try {
      await authFetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, type })
      });
      fetchHistory(); // Оновлюємо історію з БД
    } catch (e) { console.error('Failed to add to history', e) }
  };

  const clearHistory = async () => {
    if (!window.confirm('Ви впевнені, що хочете безповоротно очистити історію переглядів?')) return;
    try {
      const response = await authFetch('/api/history', { method: 'DELETE' });
      if (response.ok) setHistory([]);
    } catch (e) { console.error('Failed to clear history', e) }
  };

  const handleSearch = async (queryOverride) => {
    const query = typeof queryOverride === 'string' ? queryOverride : searchQuery;
    if (!query) return;
    setSearchQuery(query);
    setActiveTab('search');
    addToHistory(query, 'Пошук');
    try {
      const response = await authFetch(`/api/search?q=${query}`)
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json()
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
      const response = await authFetch(`/api/semantic-search?q=${searchQuery}`)
      if (!response.ok) throw new Error('Semantic search failed');
      const data = await response.json()
      setTerms(data.map(item => ({
        id: item.termId,
        term_name: item.termName,
        definition: item.definition || item.content?.split(': ')[1] || item.content,
        source_id: item.source_id,
        file_type: item.file_type,
        security_stamp: item.security_stamp || 'Public' // брати з відповіді бекенду
      })))
    } catch (error) {
      console.error('Semantic search failed:', error)
    }
  }

  const handleUpload = async () => {
    if (!uploadFile || !accessLevel) {
      showToast('Будь ласка, оберіть файл та вкажіть гриф обмеження доступу', 'error');
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
      setIsProcessing(true)
      setUploadProgress(0)
      setUploadStatusText('Підготовка до відправки...')
      setUploadError(null)
      setUploadStatus('Uploading document...')

      // Підключаємося до стріму прогресу
      eventSource = new EventSource(`/api/progress/${taskId}?token=${accessToken}`);
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

    const response = await authFetch('/api/upload', {
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
        setUploadStatus(result.error || result.message || 'Upload failed. Please try again.')
        setUploadError(`Помилка сервера: ${result.error || result.message}`)
        return
      }

      if (result.pendingTerms) {
        let termsToVerify = result.pendingTerms.map(t => ({ ...t, category: t.category || 'IT-термінологія', extended_info: t.extended_info || '', definition_source_type: 'Document' }));
        
        // Сортуємо: проблемні терміни (без опису або з коротким) піднімаємо нагору
        termsToVerify.sort((a, b) => {
          const aProblem = !a.definition || a.definition.length < 10 || a.definition === 'Опис відсутній';
          const bProblem = !b.definition || b.definition.length < 10 || b.definition === 'Опис відсутній';
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
        setUploadStatus(result.message || 'Upload completed')
        fetchTerms()
        fetchStats()
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

  // Управління Користувачами
  const handleCreateUser = async (e) => {
    e.preventDefault()
    try {
      const response = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      })
      if (response.ok) {
        setIsAddingUser(false)
        setNewUser({ full_name: '', email: '@mitit.edu.ua', password: '', role: 'user', access_level: 'Public' })
        fetchUsers()
        showToast('Користувача успішно створено!', 'success');
      } else {
        const err = await response.json()
        showToast(err.error || 'Помилка створення', 'error')
      }
    } catch (error) { showToast(error.message, 'error') }
  }

  const handleUpdateUser = async (userObj, field, value) => {
    const updatedUser = { ...userObj, [field]: value }
    setUsers(users.map(u => u.id === userObj.id ? updatedUser : u))
    try {
      const response = await authFetch(`/api/users/${userObj.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedUser)
      })
      if (!response.ok) { showToast((await response.json()).error, 'error'); fetchUsers(); }
      else { showToast('Дані користувача оновлено', 'success'); }
    } catch (e) { console.error(e); fetchUsers(); }
  }

  const handleDeleteUser = async (id) => {
    if (!window.confirm('Ви впевнені, що хочете безповоротно видалити цього співробітника?')) return;
    try {
      const response = await authFetch(`/api/users/${id}`, { method: 'DELETE' })
      if (response.ok) { fetchUsers(); showToast('Користувача видалено', 'success'); }
      else showToast((await response.json()).error, 'error');
    } catch (e) { console.error(e) }
  }

  // Зміна власного пароля
  const handleChangePassword = async (e) => {
    e.preventDefault();
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(passwordData)
      });
      if (res.ok) {
        showToast('Пароль успішно змінено!', 'success');
        setIsProfileOpen(false);
        setPasswordData({ oldPassword: '', newPassword: '' });
      } else showToast((await res.json()).error, 'error');
    } catch (err) { showToast(err.message, 'error'); }
  };

  const confirmTerms = async () => {
    const termsToSubmit = hideDuplicates ? pendingTerms.filter(t => !t.exists_in_db) : pendingTerms;
    try {
      const response = await authFetch('/api/confirm-terms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ terms: termsToSubmit, sourceId: pendingSourceId })
      })
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Помилка сервера при збереженні');
      }

      setShowVerification(false)
      setPendingTerms([])
      setPendingSourceId(null)
      fetchTerms()
      fetchStats()
      showToast('Терміни успішно збережено в базу!', 'success');
    } catch (error) {
      console.error('Confirmation failed:', error)
      showToast(`Помилка: ${error.message}`, 'error');
    }
  }

  const handlePendingTermChange = (localId, field, value) => {
    setPendingTerms(prev => prev.map(t => t.localId === localId ? { ...t, [field]: value } : t));
  };

  const handleDeletePendingTerm = (localId) => {
    setPendingTerms(prev => prev.filter(t => t.localId !== localId));
  };

  const handleGenerateDefinition = async (localId, isAuto = false) => {
    const termIndex = pendingTerms.findIndex(t => t.localId === localId);
    if (termIndex === -1) return;
    const termToUpdate = pendingTerms[termIndex];

    // Позначаємо, що для цього терміну йде генерація
    handlePendingTermChange(localId, 'is_generating', true);

    try {
      const response = await authFetch('/api/generate-definition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termName: termToUpdate.term })
      });
      const data = await response.json();

      setPendingTerms(prev => prev.map(t => t.localId === localId ? {
        ...t,
        definition: data.definition,
        extended_info: data.extended_info,
        definition_source_type: 'AI-Generated',
        is_generating: false
      } : t));
    } catch (error) {
      console.error('Failed to generate AI definition:', error);
      handlePendingTermChange(localId, 'is_generating', false);
    }
  };

  const handleUpdateTerm = async (e) => {
    e.preventDefault()
    try {
      const response = await authFetch(`/api/terms/${editingTerm.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingTerm)
      })
      if (response.ok) {
        setEditingTerm(null)
        fetchTerms()
        fetchStats()
        showToast('Зміни успішно збережено', 'success');
      }
    } catch (error) {
      console.error('Failed to update term:', error)
      showToast('Помилка оновлення терміну', 'error');
    }
  }

  const handleDeleteTerm = async (id) => {
    if (!window.confirm('Ви впевнені, що хочете безповоротно видалити цей термін з бази даних?')) return;
    try {
      const response = await authFetch(`/api/terms/${id}`, { method: 'DELETE' })
      if (response.ok) {
        fetchTerms()
        fetchStats()
        showToast('Термін успішно видалено', 'success');
      } else {
        const errData = await response.json().catch(() => ({}));
        showToast(`Помилка видалення: ${errData.error || response.statusText}`, 'error');
      }
    } catch (error) {
      console.error('Failed to delete term:', error)
      showToast(`Помилка з'єднання: ${error.message}`, 'error');
    }
  }

  const handleDeleteSource = async (id) => {
    if (!window.confirm('УВАГА! Це назавжди видалить сам документ і ВСІ терміни, які були з нього витягнуті. Продовжити?')) return;
    try {
      const response = await authFetch(`/api/sources/${id}`, { method: 'DELETE' })
      if (response.ok) {
        fetchSources(); fetchTerms(); fetchStats();
        showToast('Документ та його терміни видалено', 'success');
      } else showToast((await response.json()).error, 'error');
    } catch (e) { console.error(e) }
  }

  const openSource = (term) => {
    window.open(`/api/source/${term.source_id}`, '_blank')
  }

  const openTermDetails = (term) => {
    setSelectedTerm(term);
    addToHistory(term.term_name, 'Перегляд'); // Записуємо перегляд в історію при відкритті панелі
  }

  const openCategory = async (category, page = 1) => {
    setSelectedCategory(category);
    setActiveTab('category');
    try {
      const response = await authFetch(`/api/terms?category=${encodeURIComponent(category.title)}&page=${page}&limit=50`)
      if (!response.ok) throw new Error('Category fetch failed');
      const data = await response.json()
      setTerms(data.terms || data)
      if (data.totalPages) {
        setTotalPages(data.totalPages);
        setCurrentPage(data.page);
      }
    } catch (error) {
      console.error('Failed to fetch category terms:', error)
    }
  }

  const handlePageChange = (newPage) => {
    if (activeTab === 'category' && selectedCategory) {
      openCategory(selectedCategory, newPage);
    } else {
      fetchTerms(newPage, activeTab === 'admin' ? adminSearchQuery : '');
    }
  };

  const toggleFavorite = async (term) => {
    const isFav = favorites.some(t => t.id === term.id);
    setFavorites(prev =>
      isFav ? prev.filter(t => t.id !== term.id) : [...prev, term]
    );
    try {
      const res = await authFetch(`/api/favorites/${term.id}`, {
        method: isFav ? 'DELETE' : 'POST',
      });
      if (!res.ok) fetchFavorites();
    } catch { fetchFavorites(); }
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
    { title: 'Системи зв’язку', icon: '📡', colSpan: 'md:col-span-2', desc: 'Телекомунікації, радіообладнання, апаратне забезпечення та протоколи передачі даних.' },
    { title: 'Кібербезпека', icon: '🛡️', colSpan: 'md:col-span-1', desc: 'Захист від кібератак, хакерів та активний захист ІТ-мереж.' },
    { title: 'Криптографія', icon: '🔑', colSpan: 'md:col-span-1', desc: 'Шифрування, криптографічні алгоритми, генерація ключів та захист.' },
    { title: 'Нормативні акти', icon: '📜', colSpan: 'md:col-span-1', desc: 'Військові доктрини, закони, статути, накази та державні правила.' },
    { title: 'Радіоелектронна боротьба', icon: '📻', colSpan: 'md:col-span-1', desc: 'РЕБ, активне глушіння, радари, радіорозвідка та пеленгація.' },
    { title: 'IT-термінологія', icon: '💻', colSpan: 'md:col-span-3 lg:col-span-3', desc: 'Програмне забезпечення, штучний інтелект, алгоритми, загальні обчислення та бази даних.' },
  ];

  if (!isInitialized) {
    return <div className="flex items-center justify-center h-screen bg-gray-50"><div className="animate-spin w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full"></div></div>;
  }

  if (!user) {
    return <Login onLogin={login} />;
  }

  const duplicateCount = pendingTerms.filter(t => t.exists_in_db).length;
  const visibleTerms = hideDuplicates ? pendingTerms.filter(t => !t.exists_in_db) : pendingTerms;

  // Підрахунок глобальної статистики
  const totalTerms = Object.values(stats).reduce((sum, s) => sum + (s.total || 0), 0);
  const totalActual = Object.values(stats).reduce((sum, s) => sum + (Number(s.actual) || 0), 0);
  const actualPercentage = totalTerms > 0 ? Math.round((totalActual / totalTerms) * 100) : 0;
  const aiProcessed = Object.values(stats).reduce((sum, s) => sum + (Number(s.ai_generated) || 0), 0);

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex font-sans">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-[100] px-6 py-4 rounded-xl shadow-2xl font-bold text-white transform transition-all duration-300 animate-fade-in-up ${toast.type === 'error' ? 'bg-red-600' : 'bg-green-600'}`}>
          <div className="flex items-center gap-3">
            <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✅'}</span>
            <span>{toast.message}</span>
          </div>
        </div>
      )}

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
          {['admin', 'operator'].includes(user?.role) && (
            <a href="#" onClick={() => { setActiveTab('upload'); setIsMobileMenuOpen(false); }} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all ${activeTab === 'upload' ? 'bg-orange-500/10 text-orange-500 border border-orange-500/20' : 'hover:bg-gray-800 hover:text-white'}`}>
              <span className="text-lg">📥</span> Завантаження
            </a>
          )}
          <a href="#" onClick={logout} className="flex items-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-all hover:bg-gray-800 hover:text-red-400">
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
                <button onClick={() => setDarkMode(!darkMode)} className="text-xl p-2 hover:bg-gray-100 rounded-full transition-colors" title="Темна/Світла тема">
                  {darkMode ? '☀️' : '🌙'}
                </button>
                <div className="text-right hidden sm:block">
                  <div className="flex items-center justify-end gap-2">
                    <p className={`text-sm font-bold text-gray-800 flex items-center gap-1 ${user?.role === 'admin' ? 'cursor-pointer hover:text-orange-600' : ''}`} onClick={() => user?.role === 'admin' && setActiveTab('admin')}>
                      {user?.full_name}
                      {user?.role === 'admin' && <span className="text-xs">▼</span>}
                    </p>
                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border tracking-wider uppercase ${user?.access_level === 'Secret' ? 'bg-red-50 text-red-700 border-red-200' : user?.access_level === 'DSP' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                      {user?.access_level === 'Secret' ? 'ТАЄМНО' : user?.access_level === 'DSP' ? 'ДСК' : 'ВІДКРИТО'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{user?.role === 'admin' ? 'Адміністратор' : user?.role === 'operator' ? 'Оператор' : 'Користувач'}</p>
                </div>
                <div className={`w-9 h-9 sm:w-10 sm:h-10 shrink-0 bg-orange-100 rounded-full flex items-center justify-center text-orange-600 font-bold border border-orange-200 shadow-sm text-sm sm:text-base transition-colors cursor-pointer hover:bg-orange-200`} onClick={() => setIsProfileOpen(true)} title="Мій профіль">
                  {user?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
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
                        <p className="text-3xl sm:text-4xl font-black text-gray-800">{totalTerms}</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-green-500 transition-all duration-1000" style={{ width: `${actualPercentage}%` }}></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Актуальність</p>
                        <p className="text-3xl sm:text-4xl font-black text-green-600">{actualPercentage}%</p>
                      </div>
                      <div className="bg-gray-50 p-5 rounded-xl border border-gray-100 shadow-sm relative overflow-hidden">
                        <div className="absolute bottom-0 left-0 h-1.5 bg-gray-200 w-full"><div className="h-full bg-orange-500 transition-all duration-1000" style={{ width: totalTerms > 0 ? `${(aiProcessed / totalTerms) * 100}%` : '0%' }}></div></div>
                        <p className="text-xs text-gray-500 mb-1 font-bold uppercase tracking-wider">Опрацьовано ШІ</p>
                        <p className="text-3xl sm:text-4xl font-black text-orange-600">{aiProcessed}</p>
                      </div>
                    </div>
                  </div>

                  {/* Плитки категорій */}
                  <div className="mb-6 sm:mb-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                      {categories.map((cat) => {
                        const s = stats[cat.title] || {};
                        const total = s.total || 0;
                        const actual = Number(s.actual) || 0;
                        const catActualPercentage = total > 0 ? Math.round((actual / total) * 100) : 0;
                        return (
                          <div key={cat.title} onClick={() => openCategory(cat)} className={`bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col justify-between hover:shadow-xl hover:border-orange-200 hover:-translate-y-1.5 transition-all cursor-pointer min-h-[220px] group ${cat.colSpan}`}>
                            <div>
                              <div className="flex justify-between items-start mb-4 relative">
                                <h3 className="text-xl font-black text-gray-800 group-hover:text-orange-600 transition-colors uppercase tracking-tight flex items-center gap-2">
                                  <span>{cat.icon}</span> {cat.title}
                                </h3>
                                <button onClick={(e) => { e.stopPropagation(); fetchTerms(); fetchStats(); }} className="text-gray-300 hover:text-orange-500 transition-colors bg-white rounded-full p-1 shadow-sm border border-gray-100" title="Оновити дані">🔄</button>
                              </div>
                              <div className="grid grid-cols-2 gap-4 border-t border-b border-gray-100 py-4">
                                <div>
                                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Усього термінів</p>
                                  <p className="text-xl sm:text-2xl font-black text-gray-800">{total}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider mb-1">Актуальність</p>
                                  {total > 0 ? (
                                    <div className="flex items-center gap-2">
                                      <p className={`text-xl sm:text-2xl font-black ${catActualPercentage >= 90 ? 'text-green-600' : 'text-orange-500'}`}>{catActualPercentage}%</p>
                                      <div className="w-full bg-gray-200 rounded-full h-1.5">
                                        <div className={`h-1.5 rounded-full transition-all duration-1000 ${catActualPercentage >= 90 ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${catActualPercentage}%` }}></div>
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-sm font-bold text-gray-400 mt-1">Дані відсутні</p>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="mt-4 flex justify-end text-[10px] sm:text-xs font-bold text-gray-500 gap-2 sm:gap-0">
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
                    <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                      {activeTab === 'category' && terms.length > 0 && (
                        <>
                        <button onClick={() => {
                          let csv = '\uFEFFТермін;Визначення;Гриф;Актуальність\n';
                          terms.forEach(t => {
                            csv += `"${t.term_name.replace(/"/g, '""')}";"${t.definition.replace(/"/g, '""')}";"${t.security_stamp}";"${t.is_actual ? 'Актуально' : 'Застаріло'}"\n`;
                          });
                          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                          const link = document.createElement("a"); link.href = URL.createObjectURL(blob);
                          link.download = `Довідник_${selectedCategory?.title || 'Експорт'}.csv`; link.click();
                        }} className="w-full sm:w-auto justify-center bg-green-50 hover:bg-green-100 text-green-700 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2 border border-green-200 shadow-sm">
                          <span>📊</span> Експорт (CSV)
                        </button>
                        <button onClick={() => {
                          const printWindow = window.open('', '_blank');
                          const htmlContent = `
                            <html><head><title>Довідник: ${selectedCategory?.title}</title>
                            <style>body{font-family:sans-serif;padding:40px;color:#111827;}h1{text-align:center;border-bottom:2px solid #f97316;padding-bottom:10px;}.term{margin-bottom:20px;page-break-inside:avoid;border:1px solid #e5e7eb;padding:15px;border-radius:8px;}.term-name{font-weight:bold;font-size:1.4em;color:#ea580c;margin-bottom:8px;text-transform:uppercase;}.definition{margin-bottom:10px;line-height:1.5;}.meta{font-size:0.85em;color:#6b7280;display:flex;gap:15px;font-weight:bold;}.meta span{background:#f3f4f6;padding:4px 8px;border-radius:4px;}</style>
                            </head><body><h1>Довідник: ${selectedCategory?.title || 'Експорт'}</h1>
                            ${terms.map(t => `<div class="term"><div class="term-name">${t.term_name}</div><div class="definition">${t.definition}</div><div class="meta"><span>Гриф: ${t.security_stamp}</span><span>Стан: ${t.is_actual ? 'Актуально' : 'Застаріло'}</span></div></div>`).join('')}
                            </body></html>
                          `;
                          printWindow.document.write(htmlContent);
                          printWindow.document.close();
                          setTimeout(() => { printWindow.print(); }, 500);
                        }} className="w-full sm:w-auto justify-center bg-red-50 hover:bg-red-100 text-red-700 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2 border border-red-200 shadow-sm">
                          <span>📄</span> Експорт (PDF)
                        </button>
                        </>
                      )}
                      <button onClick={() => { setActiveTab('dashboard'); setSearchQuery(''); }} className="w-full sm:w-auto justify-center bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2">
                        <span>←</span> На Головну
                      </button>
                    </div>
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
                      <div className="col-span-full text-center py-16 bg-white rounded-xl border border-gray-100 shadow-sm">
                        <p className="text-5xl mb-4">🔍</p>
                        <p className="text-xl font-bold text-gray-800 mb-2">Нічого не знайдено</p>
                        <p className="text-gray-500 text-sm">
                          Спробуйте змінити запит або скористайтесь{' '}
                          <button onClick={handleSemanticSearch} className="text-indigo-600 hover:text-indigo-800 hover:underline font-bold">
                            ✨ AI-пошуком
                          </button>
                        </p>
                      </div>
                    )}
                  </div>
                  
                  {/* Пагінація для категорій та термінів */}
                  {totalPages > 1 && ['category', 'my-terms'].includes(activeTab) && (
                    <div className="flex justify-center gap-2 mt-8 pt-4 border-t border-gray-100">
                      <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-50 transition-colors">
                        ← Назад
                      </button>
                      <span className="px-4 py-2 text-sm font-bold text-gray-700 bg-gray-50 rounded-lg border border-gray-200 flex items-center">
                        {currentPage} / {totalPages}
                      </span>
                      <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-50 transition-colors">
                        Вперед →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'history' && (
                <div className="bg-white p-4 sm:p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 border-b border-gray-100 pb-4 gap-4 sm:gap-0">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">🕒 Історія активності</h2>
                      <p className="text-sm text-gray-500 font-medium mt-1">Останні пошукові запити та перегляди</p>
                    </div>
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
                      {['DSP', 'Secret'].includes(user?.access_level) && <option value="DSP">ДСК (Для службового користування)</option>}
                      {user?.access_level === 'Secret' && <option value="Secret">Таємно</option>}
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
                      
                      {duplicateCount > 0 && (
                        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg flex justify-between items-center shadow-sm">
                          <span className="text-sm font-bold text-yellow-800">⚠️ Знайдено {duplicateCount} дублікатів (вже є в базі). Вони відсіяні.</span>
                          <button onClick={() => setHideDuplicates(!hideDuplicates)} className="text-xs bg-white hover:bg-yellow-100 text-yellow-800 border border-yellow-300 px-3 py-1.5 rounded font-bold transition-colors">
                            {hideDuplicates ? 'Показати їх' : 'Приховати дублікати'}
                          </button>
                        </div>
                      )}

                      <div className="space-y-4 mb-6 max-h-[60vh] sm:max-h-96 overflow-y-auto pr-1 sm:pr-2">
                        {visibleTerms.length > 0 ? (
                          visibleTerms.map((term) => (
                            <div key={term.localId} className={`border rounded-lg p-4 flex gap-4 transition-colors ${term.exists_in_db ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50 border-gray-200'}`}>
                              <div className="flex-1 space-y-3">
                                {term.exists_in_db && (
                                  <div className="text-xs font-bold text-yellow-700 bg-yellow-100 px-2 py-1 rounded-md w-fit flex items-center gap-1 border border-yellow-300">⚠️ Цей термін вже є в базі</div>
                                )}
                                <input
                                  type="text"
                                  value={term.term}
                                  onChange={(e) => handlePendingTermChange(term.localId, 'term', e.target.value)}
                                  className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border bg-white font-medium"
                                  placeholder="Назва терміну"
                                />
                                <select
                                  value={term.category}
                                  onChange={(e) => handlePendingTermChange(term.localId, 'category', e.target.value)}
                                  className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-orange-500 focus:border-orange-500 sm:text-sm p-2 border bg-white font-medium text-gray-700"
                                >
                                  {categories.map(c => <option key={c.title} value={c.title}>{c.title}</option>)}
                                </select>
                                <div className="relative">
                                  <textarea
                                    value={term.definition}
                                    onChange={(e) => handlePendingTermChange(term.localId, 'definition', e.target.value)}
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
                                  <textarea value={term.extended_info} onChange={(e) => handlePendingTermChange(term.localId, 'extended_info', e.target.value)} rows="3" className="block w-full border-indigo-200 bg-indigo-50/30 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-3 pt-4 border font-medium text-gray-800" placeholder="Розширене пояснення від ШІ..."/>
                                </div>
                                <div className="flex justify-end">
                                  <button onClick={() => handleGenerateDefinition(term.localId)} disabled={term.is_generating} className="text-xs font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-100 hover:bg-indigo-200 px-3 py-1.5 rounded-md transition-colors flex items-center gap-1 disabled:opacity-50">
                                    {term.is_generating ? <><div className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div> Переписуємо...</> : <>✨ Оновити визначення</>}
                                  </button>
                                </div>
                                
                              </div>
                              <button 
                                onClick={() => handleDeletePendingTerm(term.localId)} 
                                className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-md h-fit transition-colors"
                                title="Видалити термін"
                              >
                                🗑️
                              </button>
                            </div>
                          ))
                        ) : <p className="text-gray-500 italic font-medium">ШІ не знайшов термінів для перевірки (або всі вони відсіяні як дублікати).</p>}
                      </div>
                      
                      <div className="flex flex-col sm:flex-row gap-3">
                        <button onClick={confirmTerms} disabled={visibleTerms.length === 0 || isProcessing} className="w-full sm:w-auto bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2.5 px-6 rounded-lg transition-colors shadow-sm order-1 sm:order-none transition-all">
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
                user?.role !== 'admin' ? (
                  <div className="text-center py-20 bg-white rounded-xl shadow-sm border border-gray-200">
                    <p className="text-5xl mb-4">🔒</p>
                    <p className="text-xl font-bold text-gray-800">Доступ заборонено</p>
                    <p className="text-gray-500 mt-2">Ця сторінка доступна лише адміністраторам.</p>
                    <button onClick={() => setActiveTab('dashboard')} className="mt-6 bg-gray-900 hover:bg-black transition-colors text-white font-bold py-2.5 px-6 rounded-lg">
                      На головну
                    </button>
                  </div>
                ) : (
                <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-4 gap-4 sm:gap-0">
                    <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">Панель Адміністратора</h2>
                    {adminTab === 'users' && (
                      <button onClick={() => setIsAddingUser(true)} className="w-full sm:w-auto bg-gray-900 hover:bg-black text-white font-bold py-2.5 px-4 rounded-lg transition-colors shadow-sm text-sm">
                        + Додати користувача
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center border-b border-gray-200 mb-6 gap-4 sm:gap-6 pb-1">
                    <div className="flex gap-4 sm:gap-6 overflow-x-auto whitespace-nowrap">
                      <button onClick={() => setAdminTab('users')} className={`py-2 sm:py-3 font-bold text-xs sm:text-sm uppercase tracking-wider transition-colors ${adminTab === 'users' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500 hover:text-gray-800'}`}>Матриця доступів</button>
                      <button onClick={() => setAdminTab('terms')} className={`py-2 sm:py-3 font-bold text-xs sm:text-sm uppercase tracking-wider transition-colors ${adminTab === 'terms' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500 hover:text-gray-800'}`}>Керування термінами ({terms.length})</button>
                      <button onClick={() => setAdminTab('sources')} className={`py-2 sm:py-3 font-bold text-xs sm:text-sm uppercase tracking-wider transition-colors ${adminTab === 'sources' ? 'border-b-2 border-orange-500 text-orange-600' : 'text-gray-500 hover:text-gray-800'}`}>База документів ({sources.length})</button>
                    </div>
                    {adminTab === 'terms' && (
                      <div className="flex flex-col sm:flex-row gap-3 sm:ml-auto w-full sm:w-auto">
                        <select
                          onChange={(e) => {
                            const [field, dir] = e.target.value.split('_');
                            if (!field) return;
                            const sorted = [...terms].sort((a, b) => {
                              const aVal = a[field] || ''; const bVal = b[field] || '';
                              if (dir === 'asc') return aVal > bVal ? 1 : -1;
                              return aVal < bVal ? 1 : -1;
                            });
                            setTerms(sorted);
                          }}
                          className="bg-white border border-gray-300 text-gray-900 text-sm font-semibold rounded-lg focus:ring-orange-500 block p-2 w-full sm:w-auto"
                        >
                          <option value="">Сортування</option>
                          <option value="term_name_asc">Назва А→Я</option>
                          <option value="term_name_desc">Назва Я→А</option>
                        </select>
                        <input type="text" placeholder="Швидкий пошук..." value={adminSearchQuery} onChange={(e) => setAdminSearchQuery(e.target.value)} className="bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 block p-2 w-full sm:w-64" />
                      </div>
                    )}
                  </div>

                  {adminTab === 'users' ? (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                            <th className="p-4 font-semibold rounded-tl-lg">Користувач</th>
                            <th className="p-4 font-semibold">Email</th>
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
                              <td className="p-4 text-gray-600 font-medium">{user.email}</td>
                              <td className="p-4">
                                <select value={user.role} onChange={(e) => handleUpdateUser(user, 'role', e.target.value)} className="bg-white border border-gray-300 text-gray-900 text-xs font-semibold rounded-lg focus:ring-orange-500 block p-2 w-full max-w-[150px]">
                                  <option value="user">Користувач</option>
                                  <option value="operator">Оператор</option>
                                  <option value="admin">Адмін</option>
                                </select>
                              </td>
                              <td className="p-4">
                                <select 
                                  className="bg-white border border-gray-300 text-gray-900 text-xs font-semibold rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-2 w-full max-w-[200px]"
                                  value={user.clearance}
                                  onChange={(e) => handleUpdateUser(user, 'clearance', e.target.value)}
                                >
                                  <option value="Public">Відкрита інформація</option>
                                  <option value="DSP">ДСК (Службове)</option>
                                  <option value="Secret">Таємно (Secret)</option>
                                </select>
                              </td>
                              <td className="p-4">
                                <button onClick={() => handleUpdateUser(user, 'status', user.status === 'Активний' ? 'Заблокований' : 'Активний')} className={`px-2.5 py-1 rounded-md text-xs font-bold border tracking-wide uppercase transition-colors ${user.status === 'Активний' ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
                                  {user.status}
                                </button>
                              </td>
                              <td className="p-4 text-right">
                                <button onClick={() => handleDeleteUser(user.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-md transition-colors font-bold text-xs">
                                  🗑️ Видалити
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : adminTab === 'sources' ? (
                    <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-200 text-sm text-gray-600">
                            <th className="p-4 font-semibold rounded-tl-lg">Назва файлу</th>
                            <th className="p-4 font-semibold">Дата завантаження</th>
                            <th className="p-4 font-semibold">Гриф</th>
                            <th className="p-4 font-semibold rounded-tr-lg text-right">Дії</th>
                          </tr>
                        </thead>
                        <tbody className="text-sm divide-y divide-gray-100">
                          {sources.map(source => (
                            <tr key={source.id} className="hover:bg-gray-50 transition-colors">
                              <td className="p-4 font-bold text-gray-900 flex items-center gap-2">
                                <span className="uppercase text-[10px] font-black text-gray-500 bg-gray-200 px-1.5 py-0.5 rounded border border-gray-300">.{source.file_type}</span>
                                <button onClick={() => window.open(`/api/source/${source.id}`, '_blank')} className="hover:text-orange-600 hover:underline text-left transition-colors text-wrap break-all" title="Відкрити оригінал документа">
                                  {source.file_name}
                                </button>
                              </td>
                              <td className="p-4 text-gray-600 font-medium">{new Date(source.upload_date).toLocaleDateString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                              <td className="p-4">
                                <span className={`px-2.5 py-1 rounded-md text-[10px] font-black border tracking-wider uppercase ${getSecurityBg(source.security_stamp)}`}>
                                  {getSecurityLabel(source.security_stamp)}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                <button onClick={() => handleDeleteSource(source.id)} className="text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-md transition-colors font-bold text-xs">
                                  🗑️ Видалити
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
                      
                      {/* Пагінація для Адмін-панелі */}
                      {totalPages > 1 && adminTab === 'terms' && (
                        <div className="flex justify-center gap-2 mt-6 py-4">
                          <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-50 transition-colors">
                            ← Назад
                          </button>
                          <span className="px-4 py-2 text-sm font-bold text-gray-700 bg-gray-50 rounded-lg border border-gray-200 flex items-center">
                            {currentPage} / {totalPages}
                          </span>
                          <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium disabled:opacity-50 hover:bg-gray-50 transition-colors">
                            Вперед →
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                )
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
        
        {/* Modal: Додавання користувача */}
        {isAddingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white p-5 sm:p-8 rounded-2xl shadow-2xl w-full max-w-lg relative">
              <button onClick={() => setIsAddingUser(false)} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-gray-400 hover:text-gray-700 text-3xl leading-none">&times;</button>
              <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6 uppercase tracking-tight border-b border-gray-100 pb-4">Новий співробітник</h2>
              
              <form onSubmit={handleCreateUser} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">ПІБ Співробітника</label>
                  <input type="text" required value={newUser.full_name} onChange={(e) => setNewUser({...newUser, full_name: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-bold" placeholder="Петренко Іван Іванович" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Корпоративний Email</label>
                  <input type="email" required value={newUser.email} onChange={(e) => setNewUser({...newUser, email: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium" placeholder="name@mitit.edu.ua" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Тимчасовий пароль</label>
                  <input type="text" required value={newUser.password} onChange={(e) => setNewUser({...newUser, password: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 focus:border-orange-500 block p-3 font-medium" placeholder="qwerty123" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Роль у системі</label>
                    <select value={newUser.role} onChange={(e) => setNewUser({...newUser, role: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 block p-3 font-medium">
                      <option value="user">Користувач (Читання)</option>
                      <option value="operator">Оператор (Завантаження)</option>
                      <option value="admin">Адміністратор</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Гриф секретності</label>
                    <select value={newUser.access_level} onChange={(e) => setNewUser({...newUser, access_level: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 block p-3 font-medium">
                      <option value="Public">Відкрита інформація</option>
                      <option value="DSP">ДСК</option>
                      <option value="Secret">Таємно</option>
                    </select>
                  </div>
                </div>
                <div className="pt-6 border-t border-gray-100 flex justify-end gap-3 mt-6">
                  <button type="button" onClick={() => setIsAddingUser(false)} className="px-5 py-2.5 bg-white border border-gray-300 text-gray-700 font-bold rounded-lg hover:bg-gray-50 transition-colors">Скасувати</button>
                  <button type="submit" className="px-5 py-2.5 bg-gray-900 text-white font-bold rounded-lg hover:bg-black transition-colors shadow-sm">Створити акаунт</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Мій профіль (Зміна пароля) */}
        {isProfileOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-2 sm:p-4">
            <div className="bg-white p-5 sm:p-8 rounded-2xl shadow-2xl w-full max-w-sm relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1.5 bg-orange-500"></div>
              <button onClick={() => setIsProfileOpen(false)} className="absolute top-4 right-4 sm:top-6 sm:right-6 text-gray-400 hover:text-gray-700 text-3xl leading-none">&times;</button>
              
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full mx-auto flex items-center justify-center text-2xl font-black mb-3 border border-orange-200 shadow-sm">
                  {user?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                </div>
                <h2 className="text-xl font-bold text-gray-900 tracking-tight">{user?.full_name}</h2>
                <p className="text-sm text-gray-500 font-medium">{user?.email}</p>
              </div>

              <form onSubmit={handleChangePassword} className="space-y-4 border-t border-gray-100 pt-6">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Поточний пароль</label>
                  <input type="password" required value={passwordData.oldPassword} onChange={(e) => setPasswordData({...passwordData, oldPassword: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 block p-3" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Новий пароль</label>
                  <input type="password" required minLength="6" value={passwordData.newPassword} onChange={(e) => setPasswordData({...passwordData, newPassword: e.target.value})} className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-orange-500 block p-3" />
                </div>
                <button type="submit" className="w-full mt-2 bg-gray-900 hover:bg-black text-white font-bold py-3 rounded-lg transition-colors shadow-sm text-sm uppercase tracking-wide">
                  Змінити пароль
                </button>
              </form>
            </div>
          </div>
        )}
    </div>
  )
}

export default App
