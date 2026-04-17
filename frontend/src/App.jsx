import { useState, useEffect } from 'react'
import './App.css'

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

  return (
    <div className="app">
      {isProcessing && (
        <div className="progress-overlay">
          <div className="progress-popup">
            <div className="spinner" />
            <p>{uploadStatus}</p>
          </div>
        </div>
      )}
      <h1>Інформаційно-довідкова система</h1>

      <div className="upload-section">
        <h2>Завантажити документ</h2>
        <input type="file" accept=".pdf,.docx,.doc" onChange={(e) => setUploadFile(e.target.files[0])} />
        <select value={accessLevel} onChange={(e) => setAccessLevel(e.target.value)}>
          <option value="">Оберіть гриф</option>
          <option value="Public">Public</option>
          <option value="DSP">DSP</option>
          <option value="Secret">Secret</option>
        </select>
        <button onClick={handleUpload} disabled={!uploadFile || !accessLevel || isProcessing}>Завантажити</button>
        {uploadStatus && !isProcessing && <div className="upload-status">{uploadStatus}</div>}
      </div>

      {showVerification && (
        <div className="verification-section">
          <h2>Перевірка та редагування термінів</h2>
          {pendingTerms.length > 0 ? (
            pendingTerms.map((term, index) => (
              <div key={index} className="verification-item">
                <input
                  type="text"
                  value={term.term}
                  onChange={(e) => handlePendingTermChange(index, 'term', e.target.value)}
                  className="term-input"
                />
                <textarea
                  value={term.definition}
                  onChange={(e) => handlePendingTermChange(index, 'definition', e.target.value)}
                  className="definition-textarea"
                />
                <button onClick={() => handleDeletePendingTerm(index)} className="delete-btn">Видалити</button>
              </div>
            ))
          ) : <p>ШІ не знайшов термінів для перевірки.</p>}
          <button onClick={confirmTerms} disabled={pendingTerms.length === 0}>Підтвердити та додати</button>
          <button onClick={() => setShowVerification(false)} className="cancel-btn">Скасувати</button>
        </div>
      )}

      <div className="search-section">
        <h2>Пошук термінів</h2>
        <input
          type="text"
          placeholder="Введіть запит"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button onClick={handleSearch}>Пошук</button>
        <button onClick={handleSemanticSearch}>Семантичний пошук</button>
        <button onClick={fetchTerms}>Показати всі</button>
      </div>

      <div className="terms-list">
        <h2>Терміни</h2>
        {terms.map(term => (
          <div key={term.id} className={`term-item ${!term.is_actual ? 'outdated' : ''}`}>
            <h3>{term.term_name}</h3>
            <p>{term.definition}</p>
            <small>Джерело: <button onClick={() => openSource(term.source_id)}>[{term.file_type}]</button></small>
            {!term.is_actual && <span className="outdated-label">Застаріло</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

export default App
