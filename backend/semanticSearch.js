// semanticSearch.js — ВИМКНЕНО (заглушки)
// Ембединги та семантичний пошук тимчасово відключені.
// Знаходження термінів у документах та їх збереження працює повністю.
// Для повторного увімкнення — відновити оригінальний файл.

async function getEmbedding()      { return null; }
async function addTermEmbedding()  { /* no-op */ }
async function semanticSearch()    { return []; }

module.exports = { addTermEmbedding, semanticSearch, getEmbedding };
