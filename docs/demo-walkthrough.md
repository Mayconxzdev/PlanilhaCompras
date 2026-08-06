# Roteiro de demonstração

Este roteiro permite avaliar o **Catálogo Operacional de Compras** em menos de dois minutos, sem acessar dados operacionais.

## 1. Iniciar com dados demonstrativos

Execute `.\scripts\run-demo.ps1` no PowerShell e abra `http://127.0.0.1:8090`. A aplicação cria uma cópia local de `demo-data/seed.json` em `.runtime/`; essa pasta é ignorada pelo Git.

Confirme no topo e na barra lateral que a identidade exibida é **Catálogo Operacional de Compras** e que o ambiente está marcado como demonstração local.

## 2. Encontrar uma especificação técnica

Pesquise por `chapa inox 316`. O resultado demonstra a leitura de nome, material, liga e medida, além do último preço e do fornecedor fictício. Explique que, na versão interna, a mesma busca pode partir de código, nome ou fornecedor sem exigir que a pessoa saiba em qual aba ou família o item havia sido cadastrado.

## 3. Cadastrar um material sem misturar campos

Abra **Novo material**. O formulário separa nome comercial, fornecedor, fabricante, código interno, código do fabricante, unidade e especificações. O objetivo é impedir que informações importantes fiquem presas em uma descrição livre.

## 4. Demonstrar a proteção contra sobrescrita

Abra a mesma base em duas janelas. Após salvar uma alteração em uma delas, tente salvar a cópia antiga na outra. A API compara a `revision` recebida com a atual e devolve um conflito; a interface orienta a pessoa a recarregar os dados, em vez de perder a alteração mais recente.

## 5. Mostrar o que foi validado automaticamente

Execute:

```powershell
python -m unittest discover -s tests -v
python scripts/validate_public_identity.py
```

A validação cobre a massa sintética, o carregamento da API, o conflito de revisão, a proteção de escrita em modo não demonstrativo e a identidade pública do produto.

## Limite intencional

O roteiro demonstra uma solução local usada para busca, registro e histórico de compras. Ele não afirma substituir um ERP, nem apresenta autenticação corporativa ou operação em grande escala como se já estivessem prontas.
