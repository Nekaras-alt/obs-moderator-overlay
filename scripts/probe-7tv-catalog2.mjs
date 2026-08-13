const SEVEN_GQL = 'https://7tv.io/v3/gql'

async function gql(query, variables = {}) {
  const r = await fetch(SEVEN_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables })
  })
  const j = await r.json()
  return j
}

function names(j) {
  return j?.data?.emotes?.items?.slice(0, 8)?.map((e) => e.name) || j?.errors?.[0]?.message
}

// Try variants the website might use
const sorts = [
  { value: 'popularity', order: 'DESCENDING' },
  { value: 'trending_daily', order: 'DESCENDING' },
  { value: 'trending_weekly', order: 'DESCENDING' },
  { value: 'trending_monthly', order: 'DESCENDING' },
  { value: 'age', order: 'DESCENDING' },
  { value: 'created_at', order: 'DESCENDING' },
  { value: 'uploaded_date', order: 'DESCENDING' },
  { value: 'channel_count', order: 'DESCENDING' },
  { value: 'hot_daily', order: 'DESCENDING' },
  { value: 'hot_weekly', order: 'DESCENDING' },
  { value: 'hot_monthly', order: 'DESCENDING' },
]

const Q = `query($q:String!,$page:Int,$limit:Int,$sort:Sort){
  emotes(query:$q,page:$page,limit:$limit,sort:$sort){
    count items { id name }
  }
}`

for (const sort of sorts) {
  const j = await gql(Q, { q: '', page: 1, limit: 8, sort })
  console.log(JSON.stringify(sort), '=>', names(j))
}

// Also try filter with date range
const Q2 = `query($q:String!,$page:Int,$limit:Int,$sort:Sort,$filter:EmoteSearchFilter){
  emotes(query:$q,page:$page,limit:$limit,sort:$sort,filter:$filter){
    count items { id name created_at lifecycle }
  }
}`

const filters = [
  { category: 'TRENDING' },
  { category: 'TOP' },
  { category: 'NEW' },
  { trending_period: 'DAY' },
  { trending_period: 'WEEK' },
  { trending_period: 'MONTH' },
  { time_period: 'DAY' },
]

for (const filter of filters) {
  const j = await gql(Q2, {
    q: '',
    page: 1,
    limit: 5,
    sort: { value: 'popularity', order: 'DESCENDING' },
    filter
  })
  console.log('filter', JSON.stringify(filter), '=>', names(j) || j?.errors?.[0]?.message)
}

// Introspect Sort / EmoteSearchFilter via __type
const intro = await gql(`{
  sort: __type(name:"Sort") { name inputFields { name type { name kind ofType { name kind } } } }
  filter: __type(name:"EmoteSearchFilter") { name inputFields { name type { name kind ofType { name kind ofType { name } } } } }
  emotes: __type(name:"Query") { fields(includeDeprecated:true) { name args { name type { name kind ofType { name } } } } }
}`)
console.log(JSON.stringify(intro, null, 2).slice(0, 5000))
