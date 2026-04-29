const fs = require('fs')

const { SUPABASE_URL, SUPABASE_KEY, GOOGLE_MAPS_KEY } = process.env

if (!SUPABASE_URL || !SUPABASE_KEY || !GOOGLE_MAPS_KEY) {
  console.error('Variables manquantes : SUPABASE_URL, SUPABASE_KEY, GOOGLE_MAPS_KEY')
  process.exit(1)
}

fs.writeFileSync('config.js', `const CONFIG = {
  SUPABASE_URL: '${SUPABASE_URL}',
  SUPABASE_KEY: '${SUPABASE_KEY}',
  GOOGLE_MAPS_KEY: '${GOOGLE_MAPS_KEY}'
}
`)

console.log('config.js généré avec succès')
