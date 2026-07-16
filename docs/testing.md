# Estratégia de validação

## O que é validado

- Massa pública contém produtos e fornecedores demonstrativos, sem referências ao ambiente original.
- Backend inicia com diretório temporário e não usa a pasta `.runtime/` do projeto.
- Carregamento do catálogo, gravação, conflito por revisão e proteção por token.
- Sintaxe dos módulos JavaScript canônicos.
- Navegação e responsividade são verificadas no navegador antes de publicar novas capturas.

## Executar

```powershell
python -m unittest discover -s tests -v
node --check app/renderer/app.js
node --check app/renderer/adapter.js
node --check app/renderer/enhancements.js
```

## Checagem de publicação

Antes de enviar alterações, execute uma busca de proteção adicional. O comando abaixo não deve retornar resultados:

```powershell
rg -n -i '192\.168\.|\\\\|C:\\Users\\|@.*\.(com|com\.br|org|net)' . -g '!app/renderer/*.min.js' -g '!\.git/**'
```

Revisar manualmente falsos positivos de documentação, exemplos e domínios `.example`. O objetivo é impedir que qualquer dado da empresa ou ambiente operacional entre no repositório público.
