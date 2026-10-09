// Проверка MCP-сервера так же, как его вызывает Claude: node mcp/dev/test-client.mjs
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';

const client = new Client({name: 'freefield-test', version: '1.0.0'});
await client.connect(new StdioClientTransport({command: process.execPath, args: ['server.js'], cwd: fileURLToPath(new URL('..', import.meta.url)), stderr: 'inherit', env: {...process.env}}));
const short = r => r.content.map(c => c.type === 'image' ? `[image ${c.mimeType}, ${Math.round(c.data.length * 0.75 / 1024)} KB]` : c.text).join('\n');

const {tools} = await client.listTools();
console.log('ИНСТРУМЕНТЫ:', tools.map(t => t.name).join(', '));
console.log('\n--- account_status\n' + short(await client.callTool({name: 'account_status', arguments: {}})));
const models = short(await client.callTool({name: 'list_models', arguments: {kind: 'video'}}));
console.log('\n--- list_models (video, первые строки)\n' + models.split('\n').slice(0, 6).join('\n'));
const svc = short(await client.callTool({name: 'free_credit_services', arguments: {kind: 'video'}}));
console.log('\n--- free_credit_services (video): сервисов', (svc.match(/ — (каждый|разово)/g) || []).length, '\n' + svc.split('\n').slice(0, 5).join('\n'));

if (process.argv.includes('--generate')) {
  console.log('\n--- generate_image (бесплатно, flux-schnell)');
  const t0 = Date.now();
  let r = await client.callTool({name: 'generate_image', arguments: {prompt: 'a red fox sitting in a snowy pine forest at dawn, soft golden light, cinematic, shallow depth of field', aspect_ratio: '16:9'}},
    undefined, {onprogress: p => console.log('  прогресс:', p.message), timeout: 600000});
  while (/check_job с job_id="([^"]+)"/.test(short(r))) {
    const id = short(r).match(/job_id="([^"]+)"/)[1];
    console.log('  ' + short(r));
    r = await client.callTool({name: 'check_job', arguments: {job_id: id, wait_seconds: 60}}, undefined, {timeout: 600000});
  }
  console.log(short(r), `\n  (${Math.round((Date.now() - t0) / 1000)} с)`);
}
await client.close();
