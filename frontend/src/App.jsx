import { useState, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
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
  const [termPage, setTermPage] = useState(null); // Wikipedia-стиль сторінка для Public термінів
  const [darkMode, setDarkMode] = useState(() => {
    try { return localStorage.getItem('darkMode') === 'true'; }
    catch { return false; }
  });
  const [toast, setToast] = useState(null); // Стан для спливаючих повідомлень
  const [pendingSources, setPendingSources] = useState([]); // Документи що очікують підтвердження
  const [isEnriching, setIsEnriching] = useState(false); // OSINT збагачення терміну
  const [notifications, setNotifications] = useState([]); // Журнал активності
  const [notifTotal, setNotifTotal] = useState(0);
  const [notifLoading, setNotifLoading] = useState(false);
  const [documents, setDocuments] = useState([]); // Бібліотека документів
  const [docTypeCounts, setDocTypeCounts] = useState({}); // { 'Наказ': 3, ... }
  const [docTypeFilter, setDocTypeFilter] = useState('Всі'); // Активний фільтр
  const [docsLoading, setDocsLoading] = useState(false);
  const [docViewer, setDocViewer] = useState(null); // { doc, content, type, loading }


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
      // Перевіряємо незавершені документи (для admin та operator)
      if (['admin', 'operator'].includes(user.role)) {
        authFetch('/api/pending-sources').then(r => r.json()).then(data => {
          if (Array.isArray(data) && data.length > 0) setPendingSources(data);
        }).catch(() => {});
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

  // ── Навігація через History API ─────────────────────────────────────────
  // Записує поточний стан у браузерну історію
  const pushNav = (tab, extra = {}) => {
    const state = { tab, termPage: extra.termPage || null, category: extra.category || null, page: extra.page || 1 };
    const hash = tab + (extra.category ? '/' + encodeURIComponent(extra.category.title) : '') + (extra.termPage ? '/term/' + encodeURIComponent(extra.termPage.id) : '');
    window.history.pushState(state, '', '#' + hash);
  };

  // Відновлює стан при натисканні Back/Forward
  useEffect(() => {
    const handlePopState = (e) => {
      const state = e.state;
      if (!state) {
        setActiveTab('dashboard');
        setTermPage(null);
        setSelectedCategory(null);
        return;
      }
      setTermPage(state.termPage || null);
      if (state.category) {
        setSelectedCategory(state.category);
        setActiveTab('category');
        // Перезавантажуємо терміни категорії
        authFetch(`/api/terms?category=${encodeURIComponent(state.category.title)}&page=${state.page || 1}&limit=50`)
          .then(r => r.json())
          .then(data => {
            setTerms(data.terms || data);
            if (data.totalPages) { setTotalPages(data.totalPages); setCurrentPage(data.page); }
          }).catch(console.error);
      } else {
        setActiveTab(state.tab || 'dashboard');
      }
    };
    window.addEventListener('popstate', handlePopState);
    // Записуємо початковий стан щоб перший Back не давав порожній сторінки
    if (!window.history.state) {
      window.history.replaceState({ tab: 'dashboard', termPage: null, category: null, page: 1 }, '', '#dashboard');
    }
    return () => window.removeEventListener('popstate', handlePopState);
  }, [authFetch]);

  // Функція виклику повідомлень
  const showToast = (message, type = 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  // Відновлення чернеток після закриття браузера під час обробки
  const recoverDraftTerms = async (sourceId) => {
    try {
      showToast('Завантаження збережених термінів...', 'info');
      const res = await authFetch(`/api/draft-terms/${sourceId}`);
      const data = await res.json();
      if (!data.terms || data.terms.length === 0) {
        showToast('Чернетки не знайдено або вже підтверджені', 'error');
        return;
      }
      setPendingTerms(data.terms.map((t, i) => ({ ...t, localId: t.localId || i })));
      setPendingSourceId(data.sourceId);
      setShowVerification(true);
      setActiveTab('upload');
      pushNav('upload');
      setPendingSources(prev => prev.filter(s => s.id !== sourceId));
      showToast(`Відновлено ${data.terms.length} термінів з документа "${data.source?.file_name}"`, 'success');
    } catch (e) {
      showToast('Помилка відновлення чернеток', 'error');
    }
  };

  // OSINT збагачення існуючого терміну (Wikipedia + DuckDuckGo + Ollama)
  const enrichCurrentTerm = async () => {
    if (!termPage || isEnriching) return;
    setIsEnriching(true);
    try {
      const res = await authFetch('/api/wiki-enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ termName: termPage.term_name, definition: termPage.definition, termId: termPage.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Помилка збагачення');
      if (!data.extended_info && !data.wiki_image_url) {
        showToast('Інформацію в інтернеті не знайдено для цього терміну', 'error');
        return;
      }
      // Оновлюємо termPage в пам'яті з новими даними
      setTermPage(prev => ({
        ...prev,
        extended_info: data.extended_info || prev.extended_info,
        wiki_image_url: data.wiki_image_url || prev.wiki_image_url,
        references: data.references?.length ? data.references : (prev.references || []),
      }));
      showToast('Термін збагачено даними з відкритих джерел!', 'success');
    } catch (e) {
      showToast(`Помилка: ${e.message}`, 'error');
    } finally {
      setIsEnriching(false);
    }
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

  const fetchDocuments = async (typeFilter = docTypeFilter) => {
    setDocsLoading(true);
    try {
      const q = typeFilter && typeFilter !== 'Всі' ? `?doc_type=${encodeURIComponent(typeFilter)}` : '';
      const res = await authFetch(`/api/documents${q}`);
      const data = await res.json();
      setDocuments(data.documents || []);
      // Будуємо map { type: count }
      const counts = { 'Всі': 0 };
      (data.typeCounts || []).forEach(r => {
        counts[r.doc_type] = Number(r.cnt);
        counts['Всі'] += Number(r.cnt);
      });
      setDocTypeCounts(counts);
    } catch (e) { console.error('Failed to fetch documents', e); }
    finally { setDocsLoading(false); }
  };

  const openDocViewer = async (doc) => {
    setDocViewer({ doc, content: null, type: null, loading: true });
    try {
      const res = await authFetch(`/api/documents/${doc.id}/content`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Помилка завантаження');
      setDocViewer({ doc, content: data.content || null, type: data.type, fileUrl: data.fileUrl, isTable: data.isTable, loading: false });
    } catch (e) {
      setDocViewer({ doc, content: null, type: 'error', error: e.message, loading: false });
    }
  };

  const fetchNotifications = async (offset = 0) => {
    setNotifLoading(true);
    try {
      const res = await authFetch(`/api/notifications?limit=50&offset=${offset}`);
      const data = await res.json();
      if (offset === 0) setNotifications(data.notifications || []);
      else setNotifications(prev => [...prev, ...(data.notifications || [])]);
      setNotifTotal(data.total || 0);
    } catch (e) { console.error('Failed to fetch notifications', e); }
    finally { setNotifLoading(false); }
  };

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
      return;
    }

    const taskId = Date.now().toString();
    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('accessLevel', accessLevel);
    formData.append('taskId', taskId);

    let eventSource = null;
    let pseudoProgressInterval = null;

    setIsProcessing(true);
    setUploadProgress(0);
    setUploadStatusText('Підготовка до відправки...');
    setUploadError(null);
    setUploadStatus('Uploading document...');

    try {
      // Відкриваємо SSE ПЕРЕД відправкою файлу
      eventSource = new EventSource(`/api/progress/${taskId}?token=${accessToken}`);

      // Обіцянка яка вирішується коли SSE повідомляє done: true
      const processingDone = new Promise((resolve, reject) => {
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            setUploadProgress(data.progress || 0);
            setUploadStatusText(data.message || '');

            if (data.done) {
              if (data.error) {
                reject(new Error(data.error));
              } else {
                resolve(data);
              }
            }
          } catch (e) {
            console.warn('SSE parse error:', e);
          }
        };
        eventSource.onerror = () => {
          reject(new Error('SSE-з\'єднання перервано. Перевірте з\'єднання з сервером.'));
        };
      });

      // Псевдо-прогрес поки ШІ обробляє
      pseudoProgressInterval = setInterval(() => {
        setUploadProgress(prev => {
          if (prev >= 5 && prev < 88) return parseFloat((prev + 0.3).toFixed(1));
          return prev;
        });
      }, 1000);

      // Чекаємо 300мс на встановлення SSE перед відправкою файлу
      await new Promise(r => setTimeout(r, 300));

      // POST — повертається ОДРАЗУ (лише зберігає файл у БД)
      const response = await authFetch('/api/upload', { method: 'POST', body: formData });

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Сервер повернув некоректну відповідь (Статус: ${response.status}). Можливо, файл занадто великий або бекенд недоступний.`);
      }

      const uploadResult = await response.json();
      if (!response.ok) {
        throw new Error(uploadResult.error || uploadResult.message || 'Upload failed');
      }

      setUploadStatusText('Файл прийнято. Очікуємо обробки ШІ...');

      // Чекаємо фінальної SSE-події з pendingTerms (скільки б часу не зайняло)
      const finalData = await processingDone;

      clearInterval(pseudoProgressInterval);
      pseudoProgressInterval = null;

      if (finalData.pendingTerms && finalData.pendingTerms.length > 0) {
        let termsToVerify = finalData.pendingTerms.map(t => ({
          ...t,
          localId: Math.random().toString(36).slice(2),
          category: t.category || 'IT-термінологія',
          extended_info: t.extended_info || '',
          definition_source_type: t.definition_source_type || 'Document',
          wiki_image_url: t.wiki_image_url || null,
        }));

        termsToVerify.sort((a, b) => {
          const aP = !a.definition || a.definition.length < 10 || a.definition === 'Опис відсутній';
          const bP = !b.definition || b.definition.length < 10 || b.definition === 'Опис відсутній';
          if (aP && !bP) return -1;
          if (!aP && bP) return 1;
          return 0;
        });

        setPendingTerms(termsToVerify);
        termsToVerify.forEach((term) => {
          if (!term.definition || term.definition.length < 10 || term.definition === 'Опис відсутній') {
            handleGenerateDefinition(term.localId, true);
          }
        });
        setPendingSourceId(finalData.sourceId || uploadResult.sourceId);
        setShowVerification(true);
        setUploadStatus('Document processed by AI. Please verify the extracted terms.');
      } else {
        setUploadStatus('Upload completed — no new terms found.');
        fetchTerms();
        fetchStats();
      }

      setIsProcessing(false);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadStatus('Upload failed. Please try again.');
      setUploadError(`Збій: ${error.message}`);
    } finally {
      if (eventSource) eventSource.close();
      if (pseudoProgressInterval) clearInterval(pseudoProgressInterval);
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
    addToHistory(term.term_name, 'Перегляд');
    if (term.security_stamp === 'Public') {
      setTermPage(term);
      pushNav('term', { termPage: term });
    } else {
      setSelectedTerm(term);
    }
  }

  const openCategory = async (category, page = 1) => {
    setSelectedCategory(category);
    setActiveTab('category');
    pushNav('category', { category, page });
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

  // Кольори категорій за індексом
  const catColorList = [
    { dot: 'bg-sky-400',     grad: 'from-sky-500 to-sky-700',        text: 'text-sky-600'     },
    { dot: 'bg-rose-400',    grad: 'from-rose-500 to-rose-700',       text: 'text-rose-600'    },
    { dot: 'bg-violet-400',  grad: 'from-violet-500 to-violet-700',   text: 'text-violet-600'  },
    { dot: 'bg-amber-400',   grad: 'from-amber-500 to-amber-700',     text: 'text-amber-600'   },
    { dot: 'bg-emerald-400', grad: 'from-emerald-500 to-emerald-700', text: 'text-emerald-600' },
    { dot: 'bg-indigo-400',  grad: 'from-indigo-500 to-indigo-700',   text: 'text-indigo-600'  },
  ];

  const categories = [
    { title: "Системи зв’язку", icon: '📡', colSpan: 'md:col-span-2',            desc: 'Телекомунікації, радіообладнання, апаратне забезпечення та протоколи передачі даних.' },
    { title: 'Кібербезпека',             icon: '🛡️', colSpan: 'md:col-span-1',      desc: 'Захист від кібератак, хакерів та активний захист ІТ-мереж.' },
    { title: 'Криптографія',             icon: '🔑', colSpan: 'md:col-span-1',              desc: 'Шифрування, криптографічні алгоритми, генерація ключів та захист.' },
    { title: 'Нормативні акти',          icon: '📜', colSpan: 'md:col-span-1',              desc: 'Військові доктрини, закони, статути, накази та державні правила.' },
    { title: 'Радіоелектронна боротьба', icon: '📻', colSpan: 'md:col-span-1', desc: 'РЕБ, активне глушіння, радари, радіорозвідка та пеленгація.' },
    { title: 'IT-термінологія',           icon: '💻', colSpan: 'md:col-span-3 lg:col-span-3', desc: 'Програмне забезпечення, штучний інтелект, алгоритми, загальні обчислення та бази даних.' },
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
    <div className="h-screen overflow-hidden bg-gray-50 flex font-sans relative">
      {/* ── Водяний знак-логотип на задньому плані ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 0,
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src="/mitit-logo.png"
          alt=""
          style={{
            width: 'min(55vw, 55vh)',
            height: 'min(55vw, 55vh)',
            objectFit: 'contain',
            opacity: 0.04,
            filter: 'grayscale(100%) contrast(1.2)',
            userSelect: 'none',
            transform: 'translateX(8vw)',
          }}
        />
      </div>
      {/* ── Модальне вікно перегляду документа ── */}
      {docViewer && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-gray-950/80 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) setDocViewer(null); }}>
          <div className="flex flex-col flex-1 max-w-5xl w-full mx-auto my-4 sm:my-8 bg-white rounded-2xl shadow-2xl overflow-hidden">

            {/* Шапка viewer */}
            <div className="flex items-center gap-4 px-6 py-4 bg-slate-900 shrink-0">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-0.5">
                  {docViewer.doc.doc_type}
                </p>
                <h3 className="text-white font-bold text-sm line-clamp-2 leading-snug">
                  {docViewer.doc.title || docViewer.doc.file_name}
                </h3>
                {docViewer.doc.title && (
                  <p className="text-slate-500 text-[11px] truncate mt-0.5">{docViewer.doc.file_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full border ${
                  docViewer.doc.security_stamp === 'Secret' ? 'bg-red-900/50 border-red-700 text-red-400' :
                  docViewer.doc.security_stamp === 'DSP'    ? 'bg-yellow-900/50 border-yellow-700 text-yellow-400' :
                                                              'bg-green-900/50 border-green-700 text-green-400'
                }`}>
                  {docViewer.doc.security_stamp === 'Secret' ? '🔴 Таємно' : docViewer.doc.security_stamp === 'DSP' ? '🟡 ДСП' : '🟢 Відкрито'}
                </span>
                <button onClick={() => setDocViewer(null)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>
            </div>

            {/* Контент */}
            <div className="flex-1 overflow-auto">
              {docViewer.loading ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                  <div className="w-10 h-10 rounded-full border-t-transparent animate-spin border-orange-400" style={{borderWidth:'3px',borderStyle:'solid'}}></div>
                  <p className="text-sm font-medium">Конвертація документа...</p>
                </div>

              ) : docViewer.type === 'error' ? (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 gap-3">
                  <div className="text-4xl">⚠️</div>
                  <p className="text-sm font-semibold text-red-500">{docViewer.error}</p>
                </div>

              ) : docViewer.type === 'pdf' ? (
                <iframe
                  src={docViewer.fileUrl}
                  className="w-full h-full"
                  style={{ minHeight: '70vh', border: 'none' }}
                  title={docViewer.doc.file_name}
                />

              ) : docViewer.type === 'text' ? (
                <pre className="p-6 sm:p-10 text-sm text-gray-800 whitespace-pre-wrap font-mono leading-relaxed bg-gray-50 min-h-full">
                  {docViewer.content}
                </pre>

              ) : docViewer.type === 'html' ? (
                <div
                  className={`p-6 sm:p-10 min-h-full ${docViewer.isTable ? 'doc-table-view overflow-x-auto' : 'doc-html-view'}`}
                  dangerouslySetInnerHTML={{ __html: docViewer.content }}
                />

              ) : null}
            </div>

            {/* Футер */}
            <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between shrink-0 gap-3 flex-wrap">
              <p className="text-xs text-gray-400 shrink-0">
                {docViewer.doc.terms_count} термінів · {new Date(docViewer.doc.upload_date).toLocaleDateString('uk-UA')}
              </p>
              {/* Адмін може виправити назву */}
              {user?.role === 'admin' && !docViewer.loading && (
                <button
                  onClick={async () => {
                    const current = docViewer.doc.title || '';
                    const newTitle = window.prompt('Назва документа:', current);
                    if (newTitle === null) return;
                    await authFetch(`/api/documents/${docViewer.doc.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ doc_type: docViewer.doc.doc_type }),
                    });
                    await authFetch(`/api/documents/${docViewer.doc.id}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ title: newTitle }),
                    });
                    setDocViewer(prev => ({ ...prev, doc: { ...prev.doc, title: newTitle } }));
                    setDocuments(prev => prev.map(d => d.id === docViewer.doc.id ? { ...d, title: newTitle } : d));
                    showToast('Назву оновлено', 'success');
                  }}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 px-3 py-1.5 rounded-lg hover:bg-indigo-50 transition-colors border border-indigo-200"
                >
                  ✏️ Змінити назву
                </button>
              )}
              <button onClick={() => setDocViewer(null)} className="text-xs font-bold text-gray-500 hover:text-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">
                Закрити
              </button>
            </div>
          </div>
        </div>
      )}

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
      <aside className={`${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 fixed md:static inset-y-0 left-0 w-72 md:w-64 bg-slate-950 text-slate-300 flex-shrink-0 flex flex-col border-r border-slate-800 z-50 transition-transform duration-300 ease-in-out`}>
        {/* Логотип */}
        <div className="px-4 py-4 flex justify-between items-center border-b border-slate-800">
          <div className="flex items-center gap-3 min-w-0">
            {/* Офіційний логотип МІТІТ */}
            <div className="w-11 h-11 shrink-0 rounded-full overflow-hidden ring-2 ring-orange-500/40 shadow-lg shadow-orange-500/10 flex items-center justify-center bg-slate-900">
              <img
                src="/mitit-logo.png"
                alt="МІТІТ"
                className="w-10 h-10 object-contain"
                style={{ filter: 'brightness(1.05) saturate(1.1)' }}
              />
            </div>
            <div className="min-w-0">
              <p className="text-white font-black text-[13px] leading-tight truncate">Глосарій-КБ</p>
              <p className="text-orange-400/70 text-[9px] font-bold uppercase tracking-[0.15em]">МІТІТ ЗСУ</p>
            </div>
          </div>
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden text-slate-400 hover:text-white p-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-4 flex flex-col">
          {/* Головна навігація */}
          <nav className="px-3 pt-4 space-y-0.5 mb-4">
            <p className="px-3 mb-2 text-[10px] font-black text-slate-600 uppercase tracking-widest">Навігація</p>
            <a href="#dashboard" onClick={(e) => { e.preventDefault(); setActiveTab('dashboard'); setTermPage(null); setIsMobileMenuOpen(false); pushNav('dashboard'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'dashboard' && !termPage ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
              Головна
            </a>
            <a href="#notifications" onClick={(e) => { e.preventDefault(); setActiveTab('notifications'); setTermPage(null); fetchNotifications(0); setIsMobileMenuOpen(false); pushNav('notifications'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'notifications' && !termPage ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
              Нотифікації
              {notifTotal > 0 && <span className="ml-auto bg-orange-500/20 text-orange-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">{notifTotal > 99 ? '99+' : notifTotal}</span>}
            </a>
            <a href="#documents" onClick={(e) => { e.preventDefault(); setActiveTab('documents'); setTermPage(null); setDocTypeFilter('Всі'); fetchDocuments('Всі'); setIsMobileMenuOpen(false); pushNav('documents'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'documents' && !termPage ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414A1 1 0 0120 8.414V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2"/></svg>
              Документи
              {docTypeCounts['Всі'] > 0 && <span className="ml-auto bg-slate-700 text-slate-300 text-[10px] font-black px-1.5 py-0.5 rounded-full">{docTypeCounts['Всі']}</span>}
            </a>
            <a href="#favorites" onClick={(e) => { e.preventDefault(); setActiveTab('favorites'); setTermPage(null); setIsMobileMenuOpen(false); pushNav('favorites'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'favorites' && !termPage ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
              Обране
              {favorites.length > 0 && <span className="ml-auto bg-orange-500/20 text-orange-400 text-[10px] font-black px-1.5 py-0.5 rounded-full">{favorites.length}</span>}
            </a>
            <a href="#history" onClick={(e) => { e.preventDefault(); setActiveTab('history'); setTermPage(null); setIsMobileMenuOpen(false); pushNav('history'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'history' && !termPage ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              Історія
            </a>
          </nav>

          {/* Категорії — швидкі посилання */}
          <div className="px-3 mb-4">
            <p className="px-3 mb-2 text-[10px] font-black text-slate-600 uppercase tracking-widest">Категорії</p>
            <div className="space-y-0.5">
              {categories.map((cat, idx) => {
                const cc = catColorList[idx] || {};
                const s = stats[cat.title] || {};
                return (
                  <a key={cat.title} href={`#category/${encodeURIComponent(cat.title)}`} onClick={(e) => { e.preventDefault(); openCategory(cat); setIsMobileMenuOpen(false); }}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all ${activeTab === 'category' && selectedCategory?.title === cat.title ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-800/70 hover:text-slate-200'}`}>
                    <span className={`w-2 h-2 rounded-full shrink-0 ${cc.dot || 'bg-slate-400'}`}></span>
                    <span className="truncate text-xs font-medium">{cat.title}</span>
                    <span className="ml-auto text-[10px] text-slate-600 font-bold">{s.total || 0}</span>
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        <div className="p-3 border-t border-slate-800 space-y-0.5">
          {['admin', 'operator'].includes(user?.role) && (
            <a href="#upload" onClick={(e) => { e.preventDefault(); setActiveTab('upload'); setTermPage(null); setIsMobileMenuOpen(false); pushNav('upload'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'upload' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
              Завантажити
            </a>
          )}
          {user?.role === 'admin' && (
            <a href="#admin" onClick={(e) => { e.preventDefault(); setActiveTab('admin'); setTermPage(null); setIsMobileMenuOpen(false); pushNav('admin'); }} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all ${activeTab === 'admin' ? 'bg-orange-500/15 text-orange-400 border border-orange-500/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              Адміністрування
            </a>
          )}
          <a href="#" onClick={logout} className="flex items-center gap-3 px-3 py-2.5 rounded-lg font-semibold text-sm transition-all text-slate-500 hover:bg-slate-800 hover:text-red-400">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
            Вийти
          </a>
        </div>
      </aside>

      {/* Головна робоча зона */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10">
        
        {/* Верхня панель (Header) */}
        <header className="bg-white border-b border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-3 z-10 shadow-sm">
          {/* Мобільне меню */}
          <button onClick={() => setIsMobileMenuOpen(true)} className="md:hidden shrink-0 w-9 h-9 flex items-center justify-center text-gray-500 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>

          {/* Пошукова зона */}
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="relative flex-1 max-w-xl">
              <svg className="absolute inset-y-0 left-3 my-auto w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              <input
                type="text"
                placeholder="Пошук терміну..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(searchQuery)}
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-xl focus:ring-2 focus:ring-orange-400 focus:border-orange-400 pl-10 pr-4 py-2.5 placeholder:text-gray-400 transition-all"
              />
            </div>
            <button onClick={() => handleSearch(searchQuery)} className="hidden sm:flex items-center gap-2 bg-gray-900 hover:bg-gray-800 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              Знайти
            </button>
            <button onClick={handleSemanticSearch} className="hidden md:flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors shadow-sm" title="AI Семантичний пошук">
              <span>✨</span> AI
            </button>
            {searchQuery && (
              <button onClick={() => { setSearchQuery(''); setActiveTab('dashboard'); fetchTerms(); }} className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            )}
          </div>

          {/* Права частина: тема + профіль */}
          <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-gray-100">
            <button onClick={() => setDarkMode(!darkMode)} className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors" title="Темна/Світла тема">
              {darkMode ? (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              ) : (
                <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
              )}
            </button>

            {/* Аватар + ім'я */}
            <div className="flex items-center gap-2.5 cursor-pointer group" onClick={() => setIsProfileOpen(true)} title="Мій профіль">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-bold text-gray-800 leading-tight truncate max-w-[120px]">{user?.full_name}</p>
                <p className="text-[10px] text-gray-400 font-medium">{user?.role === 'admin' ? 'Адміністратор' : user?.role === 'operator' ? 'Оператор' : 'Користувач'}</p>
              </div>
              <div className="w-9 h-9 bg-orange-500 rounded-xl flex items-center justify-center text-white font-black text-sm shadow-sm group-hover:bg-orange-600 transition-colors">
                {user?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
              </div>
            </div>
          </div>
        </header>

            <div className="flex-1 overflow-auto p-4 sm:p-8 bg-gray-50">

              {/* ═══ БАНЕР: незавершені документи ═══ */}
              {pendingSources.length > 0 && ['admin', 'operator'].includes(user?.role) && (
                <div className="mb-4 max-w-5xl mx-auto">
                  {pendingSources.map(src => (
                    <div key={src.id} className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 shadow-sm mb-2">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-amber-500 text-xl shrink-0">⚠️</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-amber-900 truncate">Незавершений документ: {src.file_name}</p>
                          <p className="text-xs text-amber-700">{src.draft_count} термінів очікують підтвердження</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => recoverDraftTerms(src.id)} className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
                          Відновити
                        </button>
                        <button onClick={() => setPendingSources(prev => prev.filter(s => s.id !== src.id))} className="text-amber-400 hover:text-amber-600 p-1 rounded transition-colors" title="Сховати">
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ═══ WIKIPEDIA-СТИЛЬ СТОРІНКА ТЕРМІНУ (тільки Public) ═══ */}
              {termPage && (
                <div className="max-w-5xl mx-auto animate-fade-in">
                  {/* Навігація */}
                  <nav className="flex items-center gap-2 text-sm text-gray-500 mb-6 font-medium">
                    <button onClick={() => { setTermPage(null); window.history.back(); }} className="hover:text-orange-600 transition-colors flex items-center gap-1">
                      ← Назад
                    </button>
                    <span>/</span>
                    <span className="text-gray-400">{termPage.category}</span>
                    <span>/</span>
                    <span className="text-gray-800 font-bold truncate">{termPage.term_name}</span>
                  </nav>

                  <div className="flex flex-col lg:flex-row gap-8">
                    {/* Ліва колонка — основний контент */}
                    <div className="flex-1 min-w-0">
                      {/* Заголовок */}
                      <div className="mb-6 pb-4 border-b-2 border-gray-200">
                        <div className="flex flex-wrap gap-2 mb-3">
                          <span className={`px-3 py-1 rounded-full text-xs font-black border tracking-wider uppercase ${getSecurityBg(termPage.security_stamp)}`}>
                            {getSecurityLabel(termPage.security_stamp)}
                          </span>
                          <span className="px-3 py-1 rounded-full text-xs font-black border bg-gray-100 text-gray-600 border-gray-200 tracking-wider uppercase">
                            {termPage.category}
                          </span>
                          {!termPage.is_actual && (
                            <span className="px-3 py-1 rounded-full text-xs font-black border bg-orange-50 text-orange-700 border-orange-200 tracking-wider uppercase">
                              Застаріле
                            </span>
                          )}
                        </div>
                        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 uppercase tracking-tight leading-tight">
                          {termPage.term_name}
                        </h1>
                      </div>

                      {/* Визначення */}
                      <div className="mb-8">
                        <div className="bg-orange-50 border-l-4 border-orange-500 p-5 rounded-r-xl">
                          <p className="text-gray-800 leading-relaxed font-medium text-base sm:text-lg">{termPage.definition}</p>
                        </div>
                      </div>

                      {/* Розширена інформація з Markdown */}
                      {termPage.extended_info && (
                        <div className="mb-8">
                          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2 pb-2 border-b border-gray-200">
                            <span className="text-orange-500">✨</span> Детальний опис
                          </h2>
                          <div className="prose prose-base max-w-none prose-headings:font-bold prose-headings:text-gray-900 prose-p:text-gray-700 prose-p:leading-relaxed prose-strong:text-gray-900 prose-table:w-full prose-th:bg-gray-100 prose-th:font-bold prose-th:p-3 prose-th:text-left prose-td:p-3 prose-td:border prose-td:border-gray-200 prose-td:text-gray-700 prose-a:text-orange-600 prose-a:underline prose-li:text-gray-700 prose-ul:list-disc prose-ol:list-decimal prose-blockquote:border-l-orange-400 prose-blockquote:text-gray-600 prose-code:bg-gray-100 prose-code:px-1 prose-code:rounded">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {termPage.extended_info}
                            </ReactMarkdown>
                          </div>
                        </div>
                      )}

                      {/* Джерела OSINT */}
                      {termPage.references && termPage.references.length > 0 && (
                        <div className="mb-8">
                          <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2 pb-2 border-b border-gray-200">
                            <span>🔗</span> Зовнішні джерела
                          </h2>
                          <ol className="space-y-2">
                            {termPage.references.map((ref, idx) => (
                              <li key={idx} className="flex items-start gap-3 text-sm">
                                <span className="shrink-0 w-6 h-6 bg-gray-100 text-gray-600 rounded-full flex items-center justify-center font-bold text-xs border border-gray-200">{idx + 1}</span>
                                <a href={ref.url} target="_blank" rel="noreferrer" className="text-orange-600 hover:text-orange-800 hover:underline transition-colors leading-snug">
                                  {ref.title || ref.url}
                                </a>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {/* Кнопки дій */}
                      <div className="pt-6 border-t border-gray-200 flex flex-wrap gap-3">
                        <button onClick={() => openSource(termPage)} className="inline-flex items-center gap-3 bg-gray-900 hover:bg-black text-white font-bold py-3 px-6 rounded-xl transition-all shadow-sm group text-sm">
                          <span className="text-xl">📄</span>
                          <span>Оригінальний документ</span>
                          <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-[10px] uppercase border border-gray-700 group-hover:bg-gray-700 transition-colors">.{termPage.file_type}</span>
                        </button>
                        {termPage.security_stamp === 'Public' && (
                          <button
                            onClick={enrichCurrentTerm}
                            disabled={isEnriching}
                            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-700 disabled:bg-sky-300 text-white font-bold py-3 px-5 rounded-xl transition-all shadow-sm text-sm"
                          >
                            {isEnriching ? (
                              <><span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block"></span><span>Шукаємо...</span></>
                            ) : (
                              <><span>🔍</span><span>Збагатити з інтернету</span></>
                            )}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Права колонка — Infobox (Wikipedia-стиль) */}
                    <div className="lg:w-72 xl:w-80 shrink-0">
                      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden sticky top-4">
                        {/* Зображення */}
                        {termPage.wiki_image_url && (
                          <div className="bg-gray-100 border-b border-gray-200 flex items-center justify-center p-2 max-h-52 overflow-hidden">
                            <img
                              src={termPage.wiki_image_url}
                              alt={termPage.term_name}
                              className="object-contain max-h-48 w-full"
                              onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                            />
                          </div>
                        )}
                        {/* Заголовок infobox */}
                        <div className="bg-gray-100 border-b border-gray-200 px-4 py-3">
                          <p className="text-xs font-black text-gray-600 uppercase tracking-widest text-center">{termPage.term_name}</p>
                        </div>
                        {/* Поля infobox */}
                        <div className="divide-y divide-gray-100">
                          <div className="flex px-4 py-2.5 text-xs">
                            <span className="w-28 shrink-0 font-bold text-gray-500 uppercase tracking-wider">Категорія</span>
                            <span className="text-gray-800 font-medium">{termPage.category}</span>
                          </div>
                          <div className="flex px-4 py-2.5 text-xs">
                            <span className="w-28 shrink-0 font-bold text-gray-500 uppercase tracking-wider">Гриф</span>
                            <span className={`font-bold ${termPage.security_stamp === 'Secret' ? 'text-red-600' : termPage.security_stamp === 'DSP' ? 'text-yellow-600' : 'text-green-600'}`}>
                              {getSecurityLabel(termPage.security_stamp)}
                            </span>
                          </div>
                          <div className="flex px-4 py-2.5 text-xs">
                            <span className="w-28 shrink-0 font-bold text-gray-500 uppercase tracking-wider">Статус</span>
                            <span className={`font-bold ${termPage.is_actual ? 'text-green-600' : 'text-orange-500'}`}>
                              {termPage.is_actual ? 'Актуально' : 'Застаріло'}
                            </span>
                          </div>
                          {termPage.definition_source_type && (
                            <div className="flex px-4 py-2.5 text-xs">
                              <span className="w-28 shrink-0 font-bold text-gray-500 uppercase tracking-wider">Джерело</span>
                              <span className="text-gray-800 font-medium">{termPage.definition_source_type}</span>
                            </div>
                          )}
                          {termPage.created_at && (
                            <div className="flex px-4 py-2.5 text-xs">
                              <span className="w-28 shrink-0 font-bold text-gray-500 uppercase tracking-wider">Додано</span>
                              <span className="text-gray-800 font-medium">{new Date(termPage.created_at).toLocaleDateString('uk-UA')}</span>
                            </div>
                          )}
                        </div>
                        {/* Кнопка обраного */}
                        <div className="p-3 border-t border-gray-100">
                          <button onClick={() => toggleFavorite(termPage)} className={`w-full py-2 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${favorites.some(t => t.id === termPage.id) ? 'bg-yellow-50 text-yellow-700 border border-yellow-200 hover:bg-yellow-100' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'}`}>
                            {favorites.some(t => t.id === termPage.id) ? '★ В обраному' : '☆ Додати до обраного'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* ═══ ЗВИЧАЙНИЙ КОНТЕНТ (ховається поки відкрита wiki-сторінка) ═══ */}
              {!termPage && activeTab === 'dashboard' ? (
                <>
                  {/* Hero-секція */}
                  <div className="relative bg-slate-900 rounded-2xl overflow-hidden mb-6 sm:mb-8 shadow-xl">
                    {/* Декоративний фон */}
                    <div className="absolute inset-0 opacity-10">
                      <div className="absolute -top-10 -right-10 w-64 h-64 bg-orange-500 rounded-full blur-3xl"></div>
                      <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-indigo-500 rounded-full blur-3xl"></div>
                    </div>
                    <div className="relative px-6 py-6 sm:px-8 sm:py-7">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div>
                          <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">Інформаційно-довідкова система</p>
                          <h2 className="text-white text-2xl sm:text-3xl font-black tracking-tight leading-tight">
                            Вітаємо, <span className="text-orange-400">{user?.full_name?.split(' ')[0] || 'Користуваче'}!</span>
                          </h2>
                          <p className="text-slate-400 text-sm mt-1.5">База термінів кібербезпеки та зв'язку МІТІТ</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2 bg-slate-800/80 border border-slate-700 px-4 py-2 rounded-xl">
                            <div className={`w-2 h-2 rounded-full ${user?.access_level === 'Secret' ? 'bg-red-400' : user?.access_level === 'DSP' ? 'bg-yellow-400' : 'bg-green-400'} animate-pulse`}></div>
                            <span className="text-white text-xs font-bold uppercase tracking-wider">{user?.access_level === 'Secret' ? 'ТАЄМНО' : user?.access_level === 'DSP' ? 'ДСК' : 'ВІДКРИТО'}</span>
                          </div>
                        </div>
                      </div>

                      {/* Статистичні плитки */}
                      <div className="mt-5 grid grid-cols-3 gap-3 sm:gap-4">
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
                          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1.5">Термінів у базі</p>
                          <p className="text-3xl sm:text-4xl font-black text-white">{totalTerms}</p>
                          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-sky-400 rounded-full w-full"></div>
                          </div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
                          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1.5">Актуальність</p>
                          <p className="text-3xl sm:text-4xl font-black text-green-400">{actualPercentage}<span className="text-lg">%</span></p>
                          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-green-400 rounded-full transition-all duration-1000" style={{ width: `${actualPercentage}%` }}></div>
                          </div>
                        </div>
                        <div className="bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
                          <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mb-1.5">Опрац. ШІ</p>
                          <p className="text-3xl sm:text-4xl font-black text-orange-400">{aiProcessed}</p>
                          <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-orange-400 rounded-full transition-all duration-1000" style={{ width: totalTerms > 0 ? `${Math.round((aiProcessed / totalTerms) * 100)}%` : '0%' }}></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Плитки категорій */}
                  <div className="mb-6 sm:mb-10">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest">Розділи глосарію</h3>
                      <button onClick={() => { fetchTerms(); fetchStats(); }} className="text-xs text-gray-400 hover:text-orange-500 transition-colors font-medium flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                        Оновити
                      </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
                      {categories.map((cat, idx) => {
                        const s = stats[cat.title] || {};
                        const total = s.total || 0;
                        const actual = Number(s.actual) || 0;
                        const catActualPercentage = total > 0 ? Math.round((actual / total) * 100) : 0;
                        const cc = catColorList[idx] || { text: 'text-gray-600', grad: 'from-gray-500 to-gray-700', dot: 'bg-gray-400' };
                        return (
                          <div key={cat.title} onClick={() => openCategory(cat)}
                            className={`bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group ${cat.colSpan}`}>
                            {/* Кольорова шапка */}
                            <div className={`bg-gradient-to-br ${cc.grad} px-5 py-4 flex items-center justify-between`}>
                              <div className="flex items-center gap-3">
                                <span className="text-2xl">{cat.icon}</span>
                                <h3 className="text-white font-black text-sm sm:text-base uppercase tracking-tight leading-tight">{cat.title}</h3>
                              </div>
                              <div className="text-white/70 text-right">
                                <p className="text-2xl font-black text-white">{total}</p>
                                <p className="text-[9px] uppercase tracking-widest font-bold text-white/60">термінів</p>
                              </div>
                            </div>
                            {/* Тіло картки */}
                            <div className="p-4 flex-1 flex flex-col">
                              <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3 flex-1">{cat.desc}</p>
                              <div className="flex items-center justify-between">
                                <div className="flex-1 mr-4">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Актуальність</p>
                                    <p className={`text-[10px] font-black ${catActualPercentage >= 90 ? 'text-green-600' : catActualPercentage >= 60 ? 'text-amber-500' : 'text-red-500'}`}>{total > 0 ? `${catActualPercentage}%` : '—'}</p>
                                  </div>
                                  {total > 0 && (
                                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                      <div className={`h-full rounded-full transition-all duration-1000 ${catActualPercentage >= 90 ? 'bg-green-500' : catActualPercentage >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${catActualPercentage}%` }}></div>
                                    </div>
                                  )}
                                </div>
                                <span className={`text-xs font-black ${cc.text} flex items-center gap-1 group-hover:gap-2 transition-all`}>
                                  Відкрити <span>→</span>
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : null}

              {/* ── Бібліотека документів ── */}
              {!termPage && activeTab === 'documents' && (() => {
                const DOC_TYPES = [
                  { key: 'Всі',            icon: '📚', color: 'bg-slate-100 text-slate-700 border-slate-300' },
                  { key: 'Наказ',          icon: '📋', color: 'bg-red-50 text-red-700 border-red-200' },
                  { key: 'Положення',      icon: '📑', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                  { key: 'Інструкція',     icon: '📖', color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
                  { key: 'Стандарт',       icon: '🏅', color: 'bg-green-50 text-green-700 border-green-200' },
                  { key: 'Нормативний акт',icon: '⚖️', color: 'bg-purple-50 text-purple-700 border-purple-200' },
                  { key: 'Регламент',      icon: '📜', color: 'bg-orange-50 text-orange-700 border-orange-200' },
                  { key: 'Доктрина',       icon: '🎖️', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
                  { key: 'Настанова',      icon: '🗂️', color: 'bg-teal-50 text-teal-700 border-teal-200' },
                  { key: 'Словник',        icon: '📘', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
                  { key: 'Інше',           icon: '📄', color: 'bg-gray-50 text-gray-700 border-gray-200' },
                ];

                const getStampStyle = (stamp) => {
                  if (stamp === 'Secret') return 'bg-red-100 text-red-700 border-red-200';
                  if (stamp === 'DSP')    return 'bg-yellow-100 text-yellow-700 border-yellow-200';
                  return 'bg-green-100 text-green-700 border-green-200';
                };
                const getStampLabel = (stamp) => {
                  if (stamp === 'Secret') return '🔴 Таємно';
                  if (stamp === 'DSP')    return '🟡 ДСП';
                  return '🟢 Відкрито';
                };
                const fmtDate = (d) => new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });

                // Тільки типи з документами або поточно обраний
                const visibleTypes = DOC_TYPES.filter(t =>
                  t.key === 'Всі' || (docTypeCounts[t.key] || 0) > 0 || t.key === docTypeFilter
                );

                return (
                  <div className="space-y-5">
                    {/* Заголовок */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="text-xl font-bold text-gray-900 uppercase tracking-tight">📚 Бібліотека документів</h2>
                          <p className="text-sm text-gray-500 mt-0.5">Нормативно-правова база та методичні матеріали</p>
                        </div>
                        <button onClick={() => fetchDocuments(docTypeFilter)} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                          Оновити
                        </button>
                      </div>

                      {/* Фільтри-підрозділи */}
                      <div className="flex flex-wrap gap-2">
                        {visibleTypes.map(t => {
                          const cnt = docTypeCounts[t.key] || 0;
                          const isActive = docTypeFilter === t.key;
                          return (
                            <button
                              key={t.key}
                              onClick={() => {
                                setDocTypeFilter(t.key);
                                fetchDocuments(t.key);
                              }}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                                isActive
                                  ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-200'
                                  : `${t.color} hover:opacity-80`
                              }`}
                            >
                              <span>{t.icon}</span>
                              <span>{t.key}</span>
                              {cnt > 0 && (
                                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-black ${isActive ? 'bg-white/20 text-white' : 'bg-black/10'}`}>
                                  {cnt}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Сітка документів */}
                    {docsLoading ? (
                      <div className="flex items-center justify-center py-20">
                        <div className="flex flex-col items-center gap-3 text-gray-400">
                          <div className="w-8 h-8 border-orange-400 border-t-transparent rounded-full animate-spin" style={{borderWidth:'3px',borderStyle:'solid'}}></div>
                          <span className="text-sm font-medium">Завантаження документів...</span>
                        </div>
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col items-center justify-center py-24 text-gray-400">
                        <div className="text-5xl mb-4">🗄️</div>
                        <p className="text-base font-semibold">Документів не знайдено</p>
                        <p className="text-sm mt-1">У цьому підрозділі ще немає документів</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                        {documents.map(doc => {
                          const typeInfo = DOC_TYPES.find(t => t.key === doc.doc_type) || DOC_TYPES[DOC_TYPES.length - 1];
                          return (
                            <div key={doc.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all flex flex-col overflow-hidden group">
                              {/* Кольорова смуга зверху */}
                              <div className={`h-1 w-full ${doc.security_stamp === 'Secret' ? 'bg-red-500' : doc.security_stamp === 'DSP' ? 'bg-yellow-400' : 'bg-green-400'}`} />

                              <div className="p-5 flex flex-col flex-1">
                                {/* Бейджі */}
                                <div className="flex items-center gap-2 flex-wrap mb-3">
                                  <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${typeInfo.color}`}>
                                    {typeInfo.icon} {doc.doc_type}
                                  </span>
                                  <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${getStampStyle(doc.security_stamp)}`}>
                                    {getStampLabel(doc.security_stamp)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-gray-400 uppercase tracking-wide ml-auto">
                                    {(doc.file_type || '').toUpperCase()}
                                  </span>
                                </div>

                                {/* Назва — береться з тексту документа або з файлу */}
                                <h3 className="font-bold text-gray-900 text-sm leading-snug mb-1 group-hover:text-orange-600 transition-colors line-clamp-3">
                                  {doc.title || doc.file_name}
                                </h3>
                                {doc.title && (
                                  <p className="text-[11px] text-gray-400 truncate mb-1">{doc.file_name}</p>
                                )}

                                {/* Опис */}
                                {doc.description && (
                                  <p className="text-xs text-gray-500 mb-3 line-clamp-2 leading-relaxed">{doc.description}</p>
                                )}

                                {/* Метадані */}
                                <div className="mt-auto pt-3 border-t border-gray-100 flex items-center justify-between">
                                  <div className="flex items-center gap-1 text-xs text-gray-400">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                    {fmtDate(doc.upload_date)}
                                  </div>
                                  <div className="flex items-center gap-1 text-xs font-bold text-orange-500">
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                                    {doc.terms_count} термінів
                                  </div>
                                </div>

                                {/* Кнопка — переглянути терміни */}
                                <button
                                  onClick={() => {
                                    setSelectedCategory(null);
                                    authFetch(`/api/terms?source_id=${doc.id}&limit=200`)
                                      .then(r => r.json())
                                      .then(data => {
                                        setTerms(data.terms || data);
                                        const displayTitle = doc.title || doc.file_name;
                                        setSelectedCategory({ title: displayTitle, isDocSource: true });
                                        setActiveTab('category');
                                        pushNav('category', { category: { title: displayTitle, isDocSource: true } });
                                      })
                                      .catch(console.error);
                                  }}
                                  className="mt-3 w-full py-2 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                                >
                                  Переглянути терміни →
                                </button>

                                {/* Кнопка читати документ */}
                                <button
                                  onClick={() => openDocViewer(doc)}
                                  className="mt-2 w-full py-2 text-xs font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                                  Читати документ
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── Нотифікації ── */}
              {!termPage && activeTab === 'notifications' && (() => {
                // Конфігурація іконок та міток для типів подій
                const ACTION_META = {
                  user_login:    { icon: '🔐', label: 'Вхід у систему',          color: 'bg-blue-50 border-blue-200 text-blue-700' },
                  user_created:  { icon: '👤', label: 'Створено користувача',     color: 'bg-green-50 border-green-200 text-green-700' },
                  user_updated:  { icon: '✏️', label: 'Змінено дані користувача', color: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
                  user_deleted:  { icon: '🗑️', label: 'Видалено користувача',     color: 'bg-red-50 border-red-200 text-red-700' },
                  doc_uploaded:  { icon: '📄', label: 'Завантажено документ',     color: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
                  doc_confirmed: { icon: '✅', label: 'Терміни підтверджено',     color: 'bg-teal-50 border-teal-200 text-teal-700' },
                  term_edited:   { icon: '📝', label: 'Відредаговано термін',     color: 'bg-orange-50 border-orange-200 text-orange-700' },
                  term_deleted:  { icon: '❌', label: 'Видалено термін',          color: 'bg-red-50 border-red-200 text-red-700' },
                };

                const fmtTime = (ts) => {
                  const d = new Date(ts);
                  const now = new Date();
                  const diffMs = now - d;
                  const diffMin = Math.floor(diffMs / 60000);
                  const diffH = Math.floor(diffMs / 3600000);
                  const diffD = Math.floor(diffMs / 86400000);
                  if (diffMin < 1) return 'щойно';
                  if (diffMin < 60) return `${diffMin} хв тому`;
                  if (diffH < 24) return `${diffH} год тому`;
                  if (diffD < 7) return `${diffD} дн тому`;
                  return d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
                };

                const renderDetails = (n) => {
                  let d = {};
                  try { d = n.details ? JSON.parse(n.details) : {}; } catch {}
                  switch (n.action_type) {
                    case 'user_login':
                      return <span>Вхід акаунту <b>{d.email || n.user_name}</b></span>;
                    case 'user_created':
                      return <span>Новий користувач <b>{d.full_name}</b> ({d.email}) — роль: <b>{d.role}</b>, рівень: <b>{d.access_level}</b></span>;
                    case 'user_updated':
                      return <span>Оновлено <b>{d.target_name}</b>: роль <b>{d.role}</b>, рівень доступу <b>{d.clearance}</b>, статус <b>{d.status}</b></span>;
                    case 'user_deleted':
                      return <span>Видалено акаунт <b>{d.target_name}</b> ({d.target_email})</span>;
                    case 'doc_uploaded':
                      return <span>Документ <b>«{d.file_name}»</b> — знайдено <b>{d.terms_count}</b> термінів, гриф: <b>{d.access_level}</b></span>;
                    case 'doc_confirmed':
                      return <span>Підтверджено <b>{d.terms_count}</b> термінів з документа <b>«{d.file_name}»</b></span>;
                    case 'term_edited':
                      return <span>Термін <b>«{d.term_name}»</b> — категорія: <b>{d.category}</b>, актуальність: <b>{d.is_actual ? 'так' : 'ні'}</b></span>;
                    case 'term_deleted':
                      return <span>Термін <b>«{d.term_name}»</b> ({d.category}) видалено з бази</span>;
                    default:
                      return <span>{n.action_type}</span>;
                  }
                };

                return (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                    {/* Заголовок */}
                    <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold text-gray-900 uppercase tracking-tight flex items-center gap-2">
                          🔔 Нотифікації
                        </h2>
                        <p className="text-sm text-gray-500 mt-0.5">Усі події системи — {notifTotal} записів</p>
                      </div>
                      <button
                        onClick={() => fetchNotifications(0)}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                        Оновити
                      </button>
                    </div>

                    {/* Список */}
                    {notifLoading && notifications.length === 0 ? (
                      <div className="flex items-center justify-center py-20 text-gray-400">
                        <div className="flex flex-col items-center gap-3">
                          <div className="w-8 h-8 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" style={{borderWidth:'3px'}}></div>
                          <span className="text-sm font-medium">Завантаження...</span>
                        </div>
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
                        <div className="text-5xl mb-4">🔕</div>
                        <p className="text-base font-semibold">Нотифікацій поки немає</p>
                        <p className="text-sm mt-1">Тут з'являтимуться всі події системи</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-50">
                        {notifications.map((n, idx) => {
                          const meta = ACTION_META[n.action_type] || { icon: '🔹', label: n.action_type, color: 'bg-gray-50 border-gray-200 text-gray-600' };
                          const isAdminEvent = n.is_admin_action === 1;
                          return (
                            <div key={n.id} className={`flex gap-4 px-6 py-4 hover:bg-gray-50 transition-colors ${idx === 0 ? '' : ''}`}>
                              {/* Іконка */}
                              <div className="shrink-0 w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg mt-0.5">
                                {meta.icon}
                              </div>
                              {/* Контент */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    {/* Тип події */}
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <span className={`inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border ${meta.color}`}>
                                        {meta.label}
                                      </span>
                                      {isAdminEvent && (
                                        <span className="inline-flex items-center text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full border bg-purple-50 border-purple-200 text-purple-700">
                                          ⚙️ Адмін-дія
                                        </span>
                                      )}
                                    </div>
                                    {/* Деталі */}
                                    <p className="text-sm text-gray-700 leading-snug">
                                      {renderDetails(n)}
                                    </p>
                                    {/* Хто виконав */}
                                    <p className="text-xs text-gray-400 mt-1">
                                      {n.user_name || 'Система'}
                                      {n.user_role && <span className="ml-1.5 font-semibold text-gray-500">({n.user_role})</span>}
                                    </p>
                                  </div>
                                  {/* Час */}
                                  <div className="shrink-0 text-xs text-gray-400 font-medium whitespace-nowrap">
                                    {fmtTime(n.created_at)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Завантажити більше */}
                    {notifications.length < notifTotal && (
                      <div className="px-6 py-4 border-t border-gray-100">
                        <button
                          onClick={() => fetchNotifications(notifications.length)}
                          disabled={notifLoading}
                          className="w-full py-2.5 text-sm font-semibold text-gray-600 hover:text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-colors disabled:opacity-50"
                        >
                          {notifLoading ? 'Завантаження...' : `Показати більше (залишилось ${notifTotal - notifications.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Списки термінів винесено в окремі вкладки */}
              {!termPage && ['category', 'search', 'favorites'].includes(activeTab) && (
                <div className="bg-white p-4 sm:p-8 rounded-xl shadow-sm border border-gray-200">
                  <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-6 border-b border-gray-100 pb-4 gap-4 sm:gap-0">
                    <div>
                      <h2 className="text-xl sm:text-2xl font-bold text-gray-800 uppercase tracking-tight">
                        {activeTab === 'category' && selectedCategory ? `📁 Категорія: ${selectedCategory.title}` :
                         activeTab === 'search' ? `🔍 Результати пошуку: ${searchQuery}` :
                         `⭐ Обрані терміни`}
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
                      <button onClick={() => { pushNav('dashboard'); setActiveTab('dashboard'); setSearchQuery(''); setTermPage(null); }} className="w-full sm:w-auto justify-center bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2.5 px-4 rounded-lg transition-colors text-sm flex items-center gap-2">
                        <span>←</span> На Головну
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {(activeTab === 'favorites' ? favorites : terms).map(term => (
                      <div key={term.id} className={`rounded-xl shadow-sm border transition-all hover:shadow-lg hover:-translate-y-0.5 flex flex-col overflow-hidden ${term.is_actual ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-80'}`}>
                        {/* Кольорова смуга зверху + мініатюра */}
                        <div className={`h-1.5 w-full ${term.security_stamp === 'Secret' ? 'bg-red-500' : term.security_stamp === 'DSP' ? 'bg-yellow-400' : 'bg-green-500'}`} />

                        <div className="flex gap-0 flex-1">
                          {/* Мініатюра Wikipedia (тільки Public) */}
                          {term.wiki_image_url && term.security_stamp === 'Public' && (
                            <div className="w-20 sm:w-24 shrink-0 bg-gray-100 border-r border-gray-100 flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => openTermDetails(term)}>
                              <img
                                src={term.wiki_image_url}
                                alt={term.term_name}
                                className="object-cover w-full h-full"
                                onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                              />
                            </div>
                          )}

                          <div className="flex-1 p-4 sm:p-5 flex flex-col min-w-0">
                            {/* Заголовок картки */}
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap mb-1">
                                  <span className={`text-[9px] font-black border tracking-widest uppercase px-1.5 py-0.5 rounded ${getSecurityBg(term.security_stamp)}`}>
                                    {getSecurityLabel(term.security_stamp)}
                                  </span>
                                  <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">{term.category}</span>
                                </div>
                                <h3
                                  onClick={() => openTermDetails(term)}
                                  className={`text-sm sm:text-base font-bold leading-tight cursor-pointer hover:text-orange-600 transition-colors truncate ${term.is_actual ? 'text-gray-900' : 'text-gray-400 line-through'}`}
                                  title={term.term_name}
                                >
                                  {term.term_name.toUpperCase()}
                                </h3>
                              </div>
                              <button
                                onClick={() => toggleFavorite(term)}
                                className={`text-xl shrink-0 transition-all focus:outline-none ${favorites.some(t => t.id === term.id) ? 'text-yellow-400 hover:text-yellow-500' : 'text-gray-200 hover:text-gray-300'} active:scale-90`}
                                title="Додати до обраного"
                              >
                                {favorites.some(t => t.id === term.id) ? '★' : '☆'}
                              </button>
                            </div>

                            {/* Визначення */}
                            <p className={`text-xs sm:text-sm mb-4 line-clamp-3 flex-1 leading-relaxed ${term.is_actual ? 'text-gray-600' : 'text-gray-400'}`}>
                              {term.definition}
                            </p>

                            {/* Футер картки */}
                            <div className="flex items-center justify-between pt-3 border-t border-gray-100 text-xs mt-auto">
                              <button
                                onClick={() => openTermDetails(term)}
                                className="flex items-center gap-1 font-bold text-orange-600 hover:text-orange-800 transition-colors"
                              >
                                {term.security_stamp === 'Public' ? '📖 Читати детальніше →' : '🔒 Переглянути →'}
                              </button>
                              <button onClick={() => openSource(term)} className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors font-medium">
                                <span>📄</span>
                                <span className="uppercase text-[9px] font-black bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">.{term.file_type}</span>
                              </button>
                            </div>
                          </div>
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
                  {totalPages > 1 && activeTab === 'category' && (
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

              {!termPage && activeTab === 'history' && (
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

              {!termPage && activeTab === 'upload' ? (
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
                                
                                {term.references && term.references.length > 0 && (
                                  <div className="mt-3 p-3 bg-white border border-gray-200 rounded-lg shadow-sm">
                                    <strong className="block text-xs font-bold text-gray-700 mb-1">🔗 Знайдені джерела (OSINT):</strong>
                                    <ul className="list-disc pl-4 space-y-1 text-xs text-blue-600">
                                      {term.references.map((ref, idx) => (
                                        <li key={idx}><a href={ref.url} target="_blank" rel="noreferrer" className="hover:underline truncate block">{ref.title || ref.url}</a></li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                
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
              ) : !termPage && activeTab === 'admin' ? (
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
                  {selectedTerm.wiki_image_url && selectedTerm.security_stamp === 'Public' && (
                    <div className="mb-6 rounded-xl overflow-hidden border border-gray-200 shadow-sm bg-gray-50 flex items-center justify-center max-h-56">
                      <img
                        src={selectedTerm.wiki_image_url}
                        alt={selectedTerm.term_name}
                        className="object-contain max-h-56 w-full"
                        onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                      />
                    </div>
                  )}
                  <h1 className="text-2xl sm:text-4xl font-black text-gray-900 mb-6 sm:mb-8 uppercase tracking-tight">{selectedTerm.term_name}</h1>

                  <div className="prose prose-orange prose-base sm:prose-lg max-w-none mb-8 sm:mb-10">
                    <div className="bg-orange-50/50 border-l-4 border-orange-500 p-4 sm:p-6 rounded-r-xl">
                      <p className="text-gray-800 leading-relaxed font-medium m-0 text-sm sm:text-base">{selectedTerm.definition}</p>
                    </div>
                    
                    {selectedTerm.extended_info && (
                      <div className="mt-6 sm:mt-8">
                        <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-3 sm:mb-4 flex items-center gap-2"><span>✨</span> Експертне доповнення</h3>
                        <div className="bg-indigo-50/50 border border-indigo-100 p-4 sm:p-6 rounded-xl shadow-sm text-sm sm:text-base prose prose-sm sm:prose-base max-w-none prose-headings:text-gray-900 prose-headings:font-bold prose-p:text-gray-700 prose-p:leading-relaxed prose-strong:text-gray-900 prose-table:text-xs prose-th:bg-indigo-100 prose-th:text-indigo-900 prose-th:font-bold prose-th:p-2 prose-td:p-2 prose-td:border prose-td:border-indigo-200 prose-td:text-gray-700 prose-a:text-indigo-600 prose-a:underline prose-li:text-gray-700 prose-ul:list-disc prose-ol:list-decimal">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {selectedTerm.extended_info}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}
                    
                    {selectedTerm.references && selectedTerm.references.length > 0 && (
                      <div className="mt-4 p-4 sm:p-6 bg-white border border-gray-200 rounded-xl shadow-sm">
                        <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2"><span>🔗</span> Джерела OSINT:</h4>
                        <ul className="list-disc pl-5 space-y-1.5 text-sm text-blue-600">
                          {selectedTerm.references.map((ref, idx) => (
                            <li key={idx}>
                              <a href={ref.url} target="_blank" rel="noreferrer" className="hover:underline truncate block">
                                {ref.title || ref.url}
                              </a>
                            </li>
                          ))}
                        </ul>
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
