// Fix para o bug clássico "TypeError: fetch failed" em Node.js no Render:
// o Node tenta resolver DNS por IPv6 primeiro, e a rede do Render frequentemente
// falha nessa rota ao conectar no Supabase. Forçar IPv4 resolve na maioria dos casos.
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

// 1. Inicializa o servidor MCP
const server = new McpServer({
  name: "Agente Kah Presentes",
  version: "1.0.2",
});

// 2. Configura a conexão com o Supabase e filtros via variáveis de ambiente
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const companyId = process.env.COMPANY_ID; // Nova variável de segurança

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "[FATAL] SUPABASE_URL ou SUPABASE_ANON_KEY não configuradas nas env vars do Render."
  );
  process.exit(1);
}

if (!companyId) {
  console.warn(
    "[AVISO] COMPANY_ID não configurada. O agente pode não conseguir ler os dados devido às políticas de RLS ou misturar dados de inquilinos."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 3. Cadastra a ferramenta de estoque corrigida
server.tool(
  "verificar_estoque",
  "Busca produtos no estoque da Kah Presentes. Se 'nome' for informado, filtra por produtos cujo nome contenha esse termo (busca parcial, sem diferenciar maiúsculas/minúsculas). Se omitido, retorna todos os produtos.",
  {
    nome: z
      .string()
      .optional()
      .describe("Termo para filtrar produtos pelo nome, ex: 'chaveiro'"),
  },
  async ({ nome }) => {
    try {
      // Corrigido para as colunas reais: sale_price e stock_quantity
      let query = supabase
        .from("products")
        .select("id, name, description, sale_price, stock_quantity, company_id");

      // Aplica a trava de segurança por empresa se o COMPANY_ID estiver configurado
      if (companyId) {
        query = query.eq("company_id", companyId);
      }

      if (nome && nome.trim().length > 0) {
        query = query.ilike("name", `%${nome.trim()}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[verificar_estoque] erro do Supabase:", error);
        return {
          content: [
            {
              type: "text",
              text: `Erro ao acessar o banco de dados: ${error.message}`,
            },
          ],
        };
      }

      if (!data || data.length === 0) {
        const msg = nome
          ? `Nenhum produto encontrado com o nome "${nome}".`
          : "Nenhum produto cadastrado no estoque atualmente.";
        return { content: [{ type: "text", text: msg }] };
      }

      // Mapeamento corrigido com os nomes de campos reais do banco do Stockly
      const listaProdutos = data
        .map(
          (p) =>
            `- *${p.name}*: R$ ${p.sale_price} | Qtd: ${p.stock_quantity} unidades\n  Descrição: ${p.description || "Sem descrição"}`
        )
        .join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Aqui estão os produtos encontrados no estoque:\n\n${listaProdutos}`,
          },
        ],
      };
    } catch (err: any) {
      console.error("[verificar_estoque] erro interno:", err);
      console.error("[verificar_estoque] causa:", err?.cause ?? "sem cause disponível");
      return {
        content: [
          {
            type: "text",
            text: `Erro interno no servidor MCP: ${err.message}`,
          },
        ],
      };
    }
  }
);

// 4. Configura o servidor Express
const app = express();
let transport: SSEServerTransport | null = null;

app.get("/sse", async (req, res) => {
  console.log("Conexão GET recebida em /sse");
  transport = new SSEServerTransport("/messages", res);
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  console.log("Mensagem POST recebida em /messages");
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(400).send("Transporte não inicializado");
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Servidor rodando perfeitamente na porta ${port}`);
});
