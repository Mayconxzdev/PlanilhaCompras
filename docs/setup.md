# Executar e configurar

## Demonstração local

```powershell
.\scripts\run-demo.ps1
```

O script cria `.venv/`, instala as versões fixadas e inicia em `http://127.0.0.1:8090`. Na primeira execução, o backend copia `demo-data/seed.json` para `.runtime/catalog.json` e constrói o índice local quando necessário.

Para recomeçar a demonstração, encerre o servidor e remova somente `.runtime/`.

## Configuração de rede local

O exemplo abaixo é para um ambiente controlado. Ele não deve ser usado como exposição pública na internet.

```powershell
$env:PROCUREFLOW_DEMO = 'false'
$env:PROCUREFLOW_HOST = '127.0.0.1'
$env:PORT = '8090'
$env:PROCUREFLOW_ADMIN_TOKEN = '<segredo-longo-e-unico>'
python -m uvicorn server.main:app --host $env:PROCUREFLOW_HOST --port $env:PORT
```

Aplicações clientes que alteram dados precisam enviar o token no cabeçalho `X-ProcureFlow-Token`. Em uma versão para uso real, esse valor deve permanecer no gerenciador de segredos do ambiente, nunca no HTML, no Git ou em atalho de área de trabalho.
