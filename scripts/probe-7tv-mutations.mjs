const j = await (await fetch('https://7tv.io/v3/gql', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: `{
      __type(name:"Mutation") {
        fields {
          name
          args { name type { name kind ofType { name kind ofType { name } } } }
          type { name kind ofType { name } }
        }
      }
    }`
  })
})).json()

const fields = j?.data?.__type?.fields || []
for (const f of fields.filter((x) => /emote/i.test(x.name))) {
  console.log(JSON.stringify(f, null, 2))
}
