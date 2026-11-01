import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer, preview } from 'vite'

for (const mode of ['dev', 'preview']) test(`${mode}: exact canonical/legacy routes only, with query intact`, async () => {
  const server = mode === 'dev' ? await createServer({ server: { port: 0 } }) : await preview({ preview: { port: 0 } })
  if (mode === 'dev') await server.listen()
  const http = server.httpServer
  const origin = `http://127.0.0.1:${http.address().port}`

  try {
    for (const route of ['connect', 'connect/device', 'connect/shares', 'hosted', 'hosted/device', 'hosted/shares']) for (const slash of ['', '/']) {
      const path = `/${route}${slash}?code=SYNTHETIC&returnTo=https%3A%2F%2Fevil.example`
      const response = await fetch(origin + path)
      assert.equal(response.status, 200, path)
      assert.equal(new URL(response.url).search, new URL(origin + path).search)
      const html = await response.text()
      assert.match(html, /noindex, nofollow/)
      if (mode === 'preview') assert.match(html, /Checking your account/)
    }
    for (const path of ['/unknown', '/connect/other', '/hosted/device/extra', '/connect/shares/extra', '/hosted/shares/extra', '/connectivity']) {
      assert.equal((await fetch(origin + path)).status, 404, path)

    }
  } finally {
    if (mode === 'dev') await server.close()
    else await new Promise(resolve => http.close(resolve))
  }
})
