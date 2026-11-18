import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';

const CONFIG = {
  email: 'saude@engardecorretora.com.br',
  senha: 'Engarde@25',
  operadora: 'NDI',
  clienteBusca: 'AUTO VIACAO REGINAS LTDA',
  vencimentoAlvo: '16/11/2026',
  baixarNotaFiscal: true
};

async function scrollEClicarSeta(page, seletorLinhaFn, arg1, arg2) {
  await page.evaluate(() => window.scrollBy({ top: 400, behavior: 'smooth' }));
  await new Promise(r => setTimeout(r, 600));

  const coords = await page.evaluate(async (fnStr, a1, a2) => {
    const encontrarLinha = new Function('return ' + fnStr)();
    const linha = encontrarLinha(a1, a2);
    if (!linha) return null;

    const pathSeta = linha.querySelector('path[d^="M433.8 394.3"], path[d^="M433.8"]') ||
                     linha.querySelector('svg[color="#1539AA"] path');
    const alvo = pathSeta ? (pathSeta.closest('button, a, [role="button"]') || pathSeta.closest('svg') || pathSeta) : null;
    if (!alvo) return null;

    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 700));

    const rect = alvo.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, seletorLinhaFn.toString(), arg1, arg2);

  if (!coords) return false;

  await page.mouse.move(coords.x, coords.y);
  await new Promise(r => setTimeout(r, 200));
  await page.mouse.click(coords.x, coords.y);
  return true;
}

async function scrollEClicarTexto(page, textoAlvo, seletorPreferencial = 'p.MuiTypography-body1, a, button, span, p, div') {
  const coords = await page.evaluate(async (texto, sel) => {
    const candidatos = Array.from(document.querySelectorAll(sel));
    const el = candidatos.find(e => e.textContent.trim().toLowerCase() === texto.toLowerCase()) ||
               candidatos.find(e => e.textContent.trim().toLowerCase().includes(texto.toLowerCase()));
    if (!el) return null;

    const alvo = el.closest('a, button, [role="button"]') || el.parentElement || el;
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise(r => setTimeout(r, 600));

    const rect = el.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    };
  }, textoAlvo, seletorPreferencial);

  if (!coords) return false;

  await page.mouse.move(coords.x, coords.y);
  await new Promise(r => setTimeout(r, 200));
  await page.mouse.click(coords.x, coords.y);
  return true;
}

async function salvarPdfDaAba(paginaAlvo, nomeArquivoFinal, pastaDownloads) {
  try {
    await paginaAlvo.bringToFront();
    await new Promise(r => setTimeout(r, 1500));

    const urlAlvo = await paginaAlvo.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="blob:"], iframe[src*=".pdf"], iframe');
      const embed = document.querySelector('embed[src*="blob:"], embed[type="application/pdf"], object[data]');
      if (iframe && iframe.src && !iframe.src.startsWith('about:')) return iframe.src;
      if (embed && (embed.src || embed.data)) return embed.src || embed.data;
      return window.location.href;
    });

    console.log(`🔗 Capturando PDF de: ${urlAlvo}`);

    const base64Pdf = await paginaAlvo.evaluate(async (url) => {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    }, urlAlvo);

    if (base64Pdf && base64Pdf.length > 100) {
      const caminhoFinal = path.join(pastaDownloads, `${Date.now()}_${nomeArquivoFinal}`);
      fs.writeFileSync(caminhoFinal, Buffer.from(base64Pdf, 'base64'));
      console.log(`✅ Salvo com sucesso: ${caminhoFinal}`);
      return true;
    }
  } catch (e) {
    console.warn(`⚠️ Não foi possível capturar via fetch (${nomeArquivoFinal}):`, e.message);
  }
  return false;
}

async function abrirEBaixarDocumento(browser, page, nomeDocumento, pastaDownloads) {
  console.log(`⬇️ Abrindo ${nomeDocumento}...`);
  const abasAntes = await browser.pages();
  const urlAntes = page.url();
  const clicouDoc = await scrollEClicarTexto(page, nomeDocumento, 'p.MuiTypography-body1, a, button, span, p');

  if (!clicouDoc) {
    console.warn(`⚠️ Não foi possível encontrar "${nomeDocumento}" na tela.`);
    return;
  }

  await new Promise(r => setTimeout(r, 3500));
  const abasDepois = await browser.pages();
  const novaAba = abasDepois.find(p => !abasAntes.includes(p));
  const paginaDoc = novaAba || page;

  await salvarPdfDaAba(paginaDoc, nomeDocumento, pastaDownloads);

  if (novaAba) {
    await novaAba.close();
  } else if (paginaDoc.url() !== urlAntes) {
    await page.goBack({ waitUntil: 'networkidle2' });
  }
}

(async () => {
  const pastaDownloads = path.resolve('./downloads');
  if (!fs.existsSync(pastaDownloads)) {
    fs.mkdirSync(pastaDownloads, { recursive: true });
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-infobars'
    ],
    ignoreDefaultArgs: ['--enable-automation']
  });

  const browserCdp = await browser.target().createCDPSession();
  await browserCdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: pastaDownloads,
    eventsEnabled: true
  });

  const page = await browser.newPage();

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: pastaDownloads
  });

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  try {
    console.log('🚀 Acessando o Portal Empresas Hapvida / NotreDame...');
    const urlLogin = 'https://hapvidaadb2bprd.b2clogin.com/hapvidaadb2bprd.onmicrosoft.com/oauth2/v2.0/authorize?p=B2C_1_portal-empresa-login&client_id=a873a0fd-ed81-4cf2-bb25-0f6dca61bc46&nonce=defaultNonce&redirect_uri=https%3A%2F%2Fportal-empresa.hapvidagndi.com.br%2Fautenticando&scope=openid%20offline_access&response_type=code+id_token&prompt=login';

    await page.goto(urlLogin, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('⌨️ Preenchendo E-mail e Senha...');
    await page.waitForSelector('input[type="email"], input#email, input#signInName, input[type="text"]', { visible: true, timeout: 20000 });

    const campoEmail = await page.$('input[type="email"], input#email, input#signInName') || await page.$('input[type="text"]');
    const campoSenha = await page.$('input[type="password"], input#password');

    await campoEmail.type(CONFIG.email, { delay: 80 });
    await campoSenha.type(CONFIG.senha, { delay: 80 });

    await new Promise(r => setTimeout(r, 800));

    console.log('🖱️ Clicando em "Fazer login"...');
    const btnLogin = await page.$('button#next, button[type="submit"]');
    if (btnLogin) {
      await btnLogin.click();
    } else {
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase().includes('fazer login'));
        if (btn) btn.click();
      });
    }

    console.log('⏳ Aguardando tela de Seleção de contrato...');
    const seletorBuscaCliente = 'input[placeholder*="Buscar por contrato"]';
    await page.waitForSelector(seletorBuscaCliente, { visible: true, timeout: 45000 });
    await new Promise(r => setTimeout(r, 1000));

    console.log(`🔍 Escrevendo "${CONFIG.clienteBusca}" no campo de busca...`);
    const campoBuscaCliente = await page.$(seletorBuscaCliente);
    await campoBuscaCliente.click({ clickCount: 3 });
    await campoBuscaCliente.type(CONFIG.clienteBusca, { delay: 90 });
    await new Promise(r => setTimeout(r, 600));

    console.log(`🏥 Selecionando operadora (${CONFIG.operadora})...`);
    await page.waitForSelector('div[role="combobox"].MuiSelect-select', { visible: true, timeout: 10000 });
    const valorAtualOperadora = await page.$eval('div[role="combobox"].MuiSelect-select', el => el.textContent.trim());

    if (valorAtualOperadora.toUpperCase() !== CONFIG.operadora.toUpperCase()) {
      await page.evaluate(() => {
        const selectBtn = document.querySelector('div[role="combobox"].MuiSelect-select');
        if (selectBtn) {
          ['mousedown', 'mouseup', 'click'].forEach(ev => {
            selectBtn.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true, view: window }));
          });
        }
      });

      await page.waitForSelector('ul[role="listbox"] li[role="option"]', { visible: true, timeout: 10000 });
      await new Promise(r => setTimeout(r, 500));

      const opcoes = await page.$$('ul[role="listbox"] li[role="option"]');
      for (const opcao of opcoes) {
        const texto = await opcao.evaluate(el => el.textContent.trim());
        if (texto.toUpperCase() === CONFIG.operadora.toUpperCase()) {
          await opcao.click();
          break;
        }
      }
      await new Promise(r => setTimeout(r, 800));
    }

    console.log('🖱️ Clicando em "Buscar"...');
    const clicouBuscar = await page.evaluate(() => {
      const btnBuscar = Array.from(document.querySelectorAll('button.MuiButton-containedSecondary, button'))
        .find(b => b.textContent.trim() === 'Buscar');
      if (btnBuscar) {
        btnBuscar.click();
        return true;
      }
      return false;
    });

    if (!clicouBuscar) {
      throw new Error('Botão "Buscar" não encontrado.');
    }

    console.log('⏳ Aguardando resultados do contrato...');
    await page.waitForSelector('path[d^="M433.8"]', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 1500));

    console.log('📜 Rolando até o contrato Mãe e clicando na seta...');
    const entrouContrato = await scrollEClicarSeta(
      page,
      (cliente) => {
        const tagMae = Array.from(document.querySelectorAll('span, div, p, td'))
          .find(el => el.textContent.trim().toUpperCase() === 'MÃE');
        if (!tagMae) return null;

        let linha = tagMae.parentElement;
        while (linha && linha !== document.body) {
          if (linha.querySelector('path[d^="M433.8"]') && linha.textContent.toUpperCase().includes(cliente.toUpperCase())) {
            return linha;
          }
          linha = linha.parentElement;
        }
        return null;
      },
      CONFIG.clienteBusca
    );

    if (!entrouContrato) {
      throw new Error(`Não foi possível localizar o contrato Mãe para o cliente "${CONFIG.clienteBusca}".`);
    }

    console.log('⏳ Aguardando menu lateral carregar...');
    await page.waitForFunction(() => {
      return !document.body.innerText.includes('Estamos carregando as informações') &&
             Array.from(document.querySelectorAll('p.MuiTypography-body2')).some(p => p.textContent.trim() === 'Financeiro');
    }, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    console.log('💰 Clicando em "Financeiro"...');
    await page.evaluate(() => {
      const pFin = Array.from(document.querySelectorAll('p.MuiTypography-body2'))
        .find(p => p.textContent.trim() === 'Financeiro');
      if (pFin) {
        const alvo = pFin.closest('li') || pFin.parentElement || pFin;
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alvo.click();
      }
    });

    await page.waitForFunction(() => {
      return Array.from(document.querySelectorAll('p.MuiTypography-body2')).some(p => p.textContent.trim() === 'Lista de faturas');
    }, { timeout: 10000 });
    await new Promise(r => setTimeout(r, 600));

    console.log('📄 Clicando em "Lista de faturas"...');
    await page.evaluate(() => {
      const pLista = Array.from(document.querySelectorAll('p.MuiTypography-body2'))
        .find(p => p.textContent.trim() === 'Lista de faturas');
      if (pLista) {
        const alvo = pLista.closest('li, a, button') || pLista;
        alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        alvo.click();
      }
    });

    console.log('⏳ Aguardando aba "Em aberto" carregar...');
    await page.waitForFunction(() => {
      const tabs = Array.from(document.querySelectorAll('button[role="tab"].MuiTab-root'));
      return tabs.some(t => t.textContent.trim().includes('Em aberto')) && !document.body.innerText.includes('Estamos carregando as informações');
    }, { timeout: 45000 });

    await new Promise(r => setTimeout(r, 1500));

    console.log('📑 Clicando na aba "Em aberto"...');
    await page.evaluate(() => {
      const tabEmAberto = Array.from(document.querySelectorAll('button[role="tab"].MuiTab-root'))
        .find(t => t.textContent.trim().includes('Em aberto'));
      if (tabEmAberto) {
        tabEmAberto.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (tabEmAberto.getAttribute('aria-selected') !== 'true') {
          tabEmAberto.click();
        }
      }
    });

    await new Promise(r => setTimeout(r, 2000));

    const qtdFaturas = await page.evaluate((venc) => {
      const linhas = Array.from(document.querySelectorAll('tr, [role="row"]'));
      return linhas.filter(tr => tr.textContent.includes(venc)).length;
    }, CONFIG.vencimentoAlvo);

    console.log(`📋 Encontradas ${qtdFaturas} fatura(s) para o vencimento ${CONFIG.vencimentoAlvo}.`);

    for (let i = 0; i < qtdFaturas; i++) {
      console.log(`\n📂 Rolando até a fatura ${i + 1} de ${qtdFaturas} (vencimento ${CONFIG.vencimentoAlvo}) e clicando na seta...`);

      await scrollEClicarSeta(
        page,
        (venc, idx) => {
          const linhas = Array.from(document.querySelectorAll('tr, [role="row"]'))
            .filter(tr => tr.textContent.includes(venc));
          return linhas[idx] || null;
        },
        CONFIG.vencimentoAlvo,
        i
      );

      await page.waitForFunction(() => {
        return document.body.innerText.includes('Boleto.pdf') || document.body.innerText.includes('Relatório.pdf');
      }, { timeout: 30000 });

      await new Promise(r => setTimeout(r, 1500));

      await abrirEBaixarDocumento(browser, page, 'Boleto.pdf', pastaDownloads);
      await new Promise(r => setTimeout(r, 1500));

      await abrirEBaixarDocumento(browser, page, 'Relatório.pdf', pastaDownloads);
      await new Promise(r => setTimeout(r, 1500));

      if (CONFIG.baixarNotaFiscal) {
        console.log('🧾 Clicando em Acessar Nota Fiscal...');
        const abasAntes = await browser.pages();
        const urlAntesNF = page.url();
        const clicouNF = await scrollEClicarTexto(page, 'Acessar Nota Fiscal', 'p.MuiTypography-body1, a, button, span, p');

        if (clicouNF) {
          await new Promise(r => setTimeout(r, 3500));
          const abasDepois = await browser.pages();
          const novaAbaNF = abasDepois.find(p => !abasAntes.includes(p));
          const paginaNF = novaAbaNF || page;

          if (novaAbaNF) {
            await novaAbaNF.bringToFront();
            const cdpNF = await novaAbaNF.createCDPSession();
            await cdpNF.send('Page.setDownloadBehavior', {
              behavior: 'allow',
              downloadPath: pastaDownloads
            });
          }

          try {
            let clicouBtDownload = false;
            const abasAntesDownload = await browser.pages();

            for (let tentativa = 0; tentativa < 15; tentativa++) {
              for (const frame of paginaNF.frames()) {
                const coordsBt = await frame.evaluate(() => {
                  const btn = document.querySelector('input#btDownload, input[value="Download NFS-e"]');
                  if (!btn) return null;
                  btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  const rect = btn.getBoundingClientRect();
                  if (rect.width === 0 || rect.height === 0) return null;
                  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
                });

                if (coordsBt) {
                  console.log('⬇️ Clicando em Download NFS-e (#btDownload)...');
                  await paginaNF.mouse.move(coordsBt.x, coordsBt.y);
                  await new Promise(r => setTimeout(r, 200));
                  await paginaNF.mouse.click(coordsBt.x, coordsBt.y);
                  clicouBtDownload = true;
                  break;
                }
              }
              if (clicouBtDownload) break;
              await new Promise(r => setTimeout(r, 1000));
            }

            if (!clicouBtDownload) {
              console.warn('⚠️ Botão #btDownload (Download NFS-e) não encontrado no tempo limite.');
            } else {
              await new Promise(r => setTimeout(r, 4500));
              const abasPosDownload = await browser.pages();
              const abaPdfNF = abasPosDownload.find(p => !abasAntesDownload.includes(p));

              if (abaPdfNF) {
                console.log('📄 Popup da NFS-e detectado, salvando PDF...');
                await salvarPdfDaAba(abaPdfNF, 'NotaFiscal_NFSe.pdf', pastaDownloads);
                await abaPdfNF.close();
              }
            }
          } catch (e) {
            console.warn('⚠️ Erro ao baixar NFS-e:', e.message);
          }

          if (novaAbaNF && !novaAbaNF.isClosed()) {
            await novaAbaNF.close();
          } else if (paginaNF.url() !== urlAntesNF) {
            await page.goBack({ waitUntil: 'networkidle2' });
          }
        }
      }

      if (i < qtdFaturas - 1) {
        console.log('↩️ Voltando para a lista de faturas...');
        await scrollEClicarTexto(page, 'Voltar', 'button, a');
        await page.waitForFunction(() => document.body.innerText.includes('Em aberto'), { timeout: 20000 });
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log(`\n🎉 Processo concluído! Arquivos salvos em: ${pastaDownloads}`);

  } catch (erro) {
    console.error('❌ Erro na automação Hapvida/GNDI:', erro.message);
  } finally {
    // await browser.close();
  }
})();