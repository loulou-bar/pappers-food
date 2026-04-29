const { createClient } = supabase
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY)

let currentUser = null
let selectedRating = 0

const restaurantId = new URLSearchParams(window.location.search).get('id')
if (!restaurantId) window.location.href = 'index.html'

// --- Auth ---

db.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null
  if (currentUser) {
    showApp()
    loadPage()
  } else {
    window.location.href = 'index.html'
  }
})

function showApp() {
  document.getElementById('login-screen').hidden = true
  document.getElementById('app').hidden = false
  document.getElementById('user-name').textContent = currentUser.user_metadata.full_name
}

document.getElementById('logout-btn').addEventListener('click', () => {
  db.auth.signOut()
})

// --- Chargement ---

async function loadPage() {
  const [{ data: resto }, { data: reviews }] = await Promise.all([
    db.from('restaurants').select('*').eq('id', restaurantId).single(),
    db.from('reviews').select('*').eq('restaurant_id', restaurantId).order('created_at', { ascending: false })
  ])

  if (!resto) { window.location.href = 'index.html'; return }

  renderDetail(resto)
  renderReviews(reviews ?? [])
}

// --- Rendu détail restaurant ---

function renderDetail(r) {
  document.title = `${r.name} — Pappers Food`
  document.getElementById('resto-detail').innerHTML = `
    <div class="detail-card">
      <div class="detail-header">
        <h2>${r.name}</h2>
        <div class="detail-tags">
          ${r.cuisine ? `<span class="tag">${r.cuisine}</span>` : ''}
          ${r.price_range ? `<span class="tag">${r.price_range}</span>` : ''}
        </div>
      </div>
      ${r.address ? `<p class="detail-info">📍 ${r.address}</p>` : ''}
      ${r.hours ? `<p class="detail-info">🕐 ${r.hours}</p>` : ''}
      ${r.google_rating ? `<p class="detail-info">⭐ Note Google : <strong>${r.google_rating}</strong>/5</p>` : ''}
      ${r.google_maps_url ? `<a href="${r.google_maps_url}" target="_blank" class="maps-btn">Voir sur Google Maps</a>` : ''}
      <p class="detail-added-by">Proposé par ${r.added_by_name}</p>
    </div>
  `
}

// --- Rendu avis ---

function renderStarDisplay(rating) {
  const full = Math.round(rating)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function renderStarInput() {
  return [1, 2, 3, 4, 5].map(i =>
    `<span class="star ${i <= selectedRating ? 'active' : ''}" onclick="setRating(${i})">${i <= selectedRating ? '★' : '☆'}</span>`
  ).join('')
}

function renderReviews(reviews) {
  const userReview = reviews.find(r => r.user_id === currentUser.id)
  selectedRating = userReview?.rating ?? 0

  const avg = reviews.length > 0
    ? (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
    : null

  document.getElementById('reviews-section').innerHTML = `
    <div class="reviews-card">
      <h3>Avis des collègues</h3>
      ${avg ? `<p class="avg-rating">${renderStarDisplay(avg)} <strong>${avg}</strong>/5 — ${reviews.length} avis</p>` : '<p class="no-review">Aucun avis pour l\'instant</p>'}

      <div class="review-form">
        <h4>${userReview ? 'Modifier mon avis' : 'Laisser un avis'}</h4>
        <div class="stars-input" id="stars-input">${renderStarInput()}</div>
        <textarea id="review-comment" placeholder="Votre commentaire (optionnel)">${userReview?.comment ?? ''}</textarea>
        <div class="review-form-actions">
          <button onclick="submitReview()">Publier</button>
          ${userReview ? `<button class="btn-danger" onclick="deleteReview()">Supprimer mon avis</button>` : ''}
        </div>
      </div>

      <div class="reviews-list">
        ${reviews.map(r => `
          <div class="review-item ${r.user_id === currentUser.id ? 'mine' : ''}">
            <div class="review-header">
              <strong>${r.user_name}</strong>
              <span class="stars">${renderStarDisplay(r.rating)}</span>
              <span class="review-date">${new Date(r.created_at).toLocaleDateString('fr-FR')}</span>
            </div>
            ${r.comment ? `<p class="review-comment">${r.comment}</p>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `
}

function setRating(rating) {
  selectedRating = rating
  document.getElementById('stars-input').innerHTML = renderStarInput()
}

async function submitReview() {
  if (selectedRating === 0) { alert('Veuillez sélectionner une note.'); return }

  const comment = document.getElementById('review-comment').value.trim()

  await db.from('reviews').upsert({
    restaurant_id: restaurantId,
    user_id: currentUser.id,
    user_name: currentUser.user_metadata.full_name,
    rating: selectedRating,
    comment: comment || null
  }, { onConflict: 'restaurant_id,user_id' })

  loadPage()
}

async function deleteReview() {
  await db.from('reviews').delete()
    .eq('restaurant_id', restaurantId)
    .eq('user_id', currentUser.id)

  selectedRating = 0
  loadPage()
}
