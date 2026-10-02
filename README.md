# Zintharion — Ficha D&D 5e

Módulo para Foundry VTT (sistema **dnd5e**) com as regras e o visual do mundo de Zintharion.

- Ficha de personagem Zintharion (tema azul, verde-azulado e dourado, brasão, abas horizontais)
- Rank por nível (F → Ω) com emblemas
- Tabela de XP editável e níveis acima do 20
- Magias acima do 9º círculo, com espaços definidos manualmente
- Moeda **Diamante Astral** (1 DA = 10.000 PO)
- Exaustão até 10
- **Concentração Expandida** e **Explosão Arcana**
- Sincronização de fichas com o site Zintharion (Enviar/Receber)
- Compatibilidade com o Plutonium (botão de subir de nível, Importar e Diamante Astral na loja)

## Instalação

No Foundry: **Configuração → Módulos Adicionais → Instalar Módulo**, e cole no campo **URL do Manifesto**:

```
https://github.com/DevFragment/zintharion-dnd5e/releases/latest/download/module.json
```

Depois ative o módulo no mundo em **Gerenciar Módulos**.

**Requisitos:** Foundry VTT v13 ou mais novo · sistema dnd5e 5.0 ou mais novo.

### Emblemas de rank

O módulo já traz um emblema para cada rank (F, E, D, C, B, A, S, SS, X, Ω). Para usar imagens próprias, coloque-as em `Data/assets/zintharion/ranks/` com o nome do rank (ex.: `F.png`, `SS.webp`, `omega.png`). Elas têm prioridade sobre as do módulo.

## Publicar uma nova versão

1. Envie as alterações (`git push`).
2. No GitHub: **Releases → Draft a new release**, crie uma tag nova no formato `v0.6.1` e clique em **Publish release**.
3. O GitHub Actions monta o `module.zip` e anexa à Release. Quem já instalou recebe o aviso de atualização no Foundry.
