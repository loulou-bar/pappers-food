const { createClient } = supabase
const db = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY)

let currentUser = null
let autocompleteReady = false
let selectedPlaceName = ''

// --- Auth ---

db.auth.onAuthStateChange(async (_event, session) => {
  currentUser = session?.user ?? null
  if (currentUser) {
    showApp()
    loadLunchGroups()
    loadRestaurants()
  } else {
    showLogin()
  }
})

function showLogin() {
  document.getElementById('login-screen').hidden = false
  document.getElementById('app').hidden = true
}

function showApp() {
  document.getElementById('login-screen').hidden = true
  document.getElementById('app').hidden = false
  document.getElementById('user-name').textContent = currentUser.user_metadata.full_name
  document.getElementById('lunch-date-label').textContent =
    new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  if (!autocompleteReady) {
    autocompleteReady = true
    waitForMapsAndInit()
  }
}

function waitForMapsAndInit() {
  if (window.google?.maps) {
    initAutocomplete()
  } else {
    setTimeout(waitForMapsAndInit, 100)
  }
}

async function initAutocomplete() {
  try {
    const { Autocomplete } = await google.maps.importLibrary('places')
    const input = document.getElementById('place-ac-fallback')

    const ac = new Autocomplete(input, {
      types: ['establishment'],
      fields: ['name', 'formatted_address', 'url', 'rating', 'price_level', 'opening_hours']
    })

    ac.addListener('place_changed', () => {
      const place = ac.getPlace()
      if (!place?.name) return

      selectedPlaceName = place.name
      document.getElementById('resto-address').value = place.formatted_address || ''
      document.getElementById('resto-maps-url').value = place.url || ''
      document.getElementById('resto-google-rating').value = place.rating ?? ''
      document.getElementById('resto-price-range').value = priceLevelToRange(place.price_level)
      document.getElementById('resto-hours').value = place.opening_hours?.weekday_text?.join('\n') || ''
    })
  } catch {
    // Maps API non disponible : saisie manuelle
  }
}

function priceLevelToRange(level) {
  return { 1: '€', 2: '€€', 3: '€€€', 4: '€€€€' }[level] || ''
}

document.getElementById('login-btn').addEventListener('click', () => {
  db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  })
})

document.getElementById('logout-btn').addEventListener('click', () => {
  db.auth.signOut()
})

// --- Déjeuner du jour ---

const todayStr = () => new Date().toISOString().split('T')[0]
const isBeforeDeadline = () => new Date().getHours() < 13

async function loadLunchGroups() {
  const { data: groups } = await db
    .from('lunch_groups')
    .select('*, restaurants(id, name, address), lunch_members(user_id, user_name)')
    .eq('date', todayStr())
    .order('created_at', { ascending: true })

  renderLunchGroups(groups ?? [])
}

function renderLunchGroups(groups) {
  const open = isBeforeDeadline()

  document.getElementById('suggest-toggle-btn').hidden = !open
  document.getElementById('lunch-deadline').textContent = open
    ? 'Propositions ouvertes jusqu\'à 13h00'
    : 'Propositions fermées pour aujourd\'hui'

  const container = document.getElementById('lunch-groups')

  if (groups.length === 0) {
    container.innerHTML = `<p class="empty">${open ? 'Aucune proposition pour l\'instant — lancez-vous !' : 'Aucune proposition aujourd\'hui.'}</p>`
    return
  }

  container.innerHTML = groups.map(g => {
    const isMember = g.lunch_members.some(m => m.user_id === currentUser.id)
    const names = g.lunch_members.map(m => m.user_name.split(' ')[0]).join(', ')
    const count = g.lunch_members.length

    return `
      <div class="lunch-card ${isMember ? 'joined' : ''}">
        <div class="lunch-info">
          <h3 class="lunch-resto-name" onclick="window.location.href='restaurant.html?id=${g.restaurants.id}'">${g.restaurants.name}</h3>
          ${g.restaurants.address ? `<p class="address">📍 ${g.restaurants.address}</p>` : ''}
          <p class="lunch-members-list">
            <strong>${count} personne${count > 1 ? 's' : ''}</strong>${names ? ` — ${names}` : ''}
          </p>
          <p class="suggested-by">Proposé par ${g.suggested_by_name}</p>
        </div>
        ${open
          ? `<button class="${isMember ? 'btn-leave' : 'btn-join'}" onclick="toggleMembership('${g.id}', ${isMember})">
              ${isMember ? 'Quitter' : 'Rejoindre'}
            </button>`
          : `<span class="lunch-count">${count} 👤</span>`
        }
      </div>
    `
  }).join('')
}

function toggleSuggestForm() {
  const form = document.getElementById('suggest-form')
  form.hidden = !form.hidden
  if (!form.hidden) populateSuggestSelect()
}

async function populateSuggestSelect() {
  const { data: restos } = await db.from('restaurants').select('id, name').order('name')
  const select = document.getElementById('suggest-select')
  select.innerHTML = '<option value="">Choisir un restaurant...</option>' +
    (restos ?? []).map(r => `<option value="${r.id}">${r.name}</option>`).join('')
}

async function submitSuggestion() {
  const restaurantId = document.getElementById('suggest-select').value
  if (!restaurantId) { alert('Veuillez choisir un restaurant.'); return }

  const { data: group, error } = await db.from('lunch_groups').insert({
    restaurant_id: restaurantId,
    date: todayStr(),
    suggested_by: currentUser.id,
    suggested_by_name: currentUser.user_metadata.full_name
  }).select().single()

  if (error) {
    alert(error.code === '23505' ? 'Ce restaurant a déjà été proposé aujourd\'hui.' : 'Erreur lors de la proposition.')
    return
  }

  await db.from('lunch_members').insert({
    lunch_group_id: group.id,
    user_id: currentUser.id,
    user_name: currentUser.user_metadata.full_name
  })

  document.getElementById('suggest-form').hidden = true
  loadLunchGroups()
}

async function toggleMembership(groupId, isMember) {
  if (isMember) {
    await db.from('lunch_members').delete()
      .eq('lunch_group_id', groupId)
      .eq('user_id', currentUser.id)
  } else {
    await db.from('lunch_members').insert({
      lunch_group_id: groupId,
      user_id: currentUser.id,
      user_name: currentUser.user_metadata.full_name
    })
  }
  loadLunchGroups()
}

// --- Restaurants ---

async function loadRestaurants() {
  const { data: restaurants } = await db
    .from('restaurants')
    .select('*, reviews(rating)')
    .order('created_at', { ascending: false })

  renderRestaurants(restaurants ?? [])
}

function avgRating(reviews) {
  if (!reviews || reviews.length === 0) return null
  return (reviews.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1)
}

function renderStars(rating) {
  const full = Math.round(rating)
  return '★'.repeat(full) + '☆'.repeat(5 - full)
}

function renderRestaurants(restaurants) {
  const list = document.getElementById('resto-list')

  if (restaurants.length === 0) {
    list.innerHTML = '<p class="empty">Aucun restaurant pour l\'instant. Soyez le premier à en proposer un !</p>'
    return
  }

  list.innerHTML = restaurants.map(r => {
    const avg = avgRating(r.reviews)
    const count = r.reviews?.length ?? 0
    return `
      <div class="resto-card" onclick="window.location.href='restaurant.html?id=${r.id}'">
        <div class="resto-info">
          <h3>${r.name}</h3>
          <div class="resto-meta">
            ${r.cuisine ? `<span class="tag">${r.cuisine}</span>` : ''}
            ${r.price_range ? `<span class="tag">${r.price_range}</span>` : ''}
          </div>
          ${r.address ? `<p class="address">📍 ${r.address}</p>` : ''}
          <div class="resto-footer">
            ${avg
              ? `<span class="stars">${renderStars(avg)} <strong>${avg}</strong>/5 (${count} avis)</span>`
              : '<span class="no-review">Pas encore d\'avis</span>'
            }
            <span class="added-by">Proposé par ${r.added_by_name}</span>
          </div>
        </div>
        <span class="arrow">›</span>
      </div>
    `
  }).join('')
}

// --- Formulaire ajout ---

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault()

  const name = selectedPlaceName || document.getElementById('place-ac-fallback')?.value?.trim()
  if (!name) { alert('Veuillez entrer un nom de restaurant.'); return }
  const cuisine = document.getElementById('resto-cuisine').value.trim()
  const address = document.getElementById('resto-address').value.trim()
  const google_maps_url = document.getElementById('resto-maps-url').value.trim()
  const google_rating = document.getElementById('resto-google-rating').value
  const price_range = document.getElementById('resto-price-range').value
  const hours = document.getElementById('resto-hours').value.trim()

  await db.from('restaurants').insert({
    name,
    cuisine: cuisine || null,
    address: address || null,
    google_maps_url: google_maps_url || null,
    google_rating: google_rating || null,
    price_range: price_range || null,
    hours: hours || null,
    added_by: currentUser.id,
    added_by_name: currentUser.user_metadata.full_name
  })

  selectedPlaceName = ''
  e.target.reset()
  loadRestaurants()
})
