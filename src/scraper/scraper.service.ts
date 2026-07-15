import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../database/supabase.service';
import { MailerService } from '../mailer/mailer.service';
import * as puppeteer from 'puppeteer';

@Injectable()
export class ScraperService {
  private readonly logger = new Logger(ScraperService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {}

  async websiteScrapingMain(sourceSite: string = 'irshad.az'): Promise<any> {
    const startTime = new Date().toISOString();
    const sessionLogs: any[] = [];
    const addLog = (level: string, message: any, trace?: any) => {
      const logMsg =
        String(message) +
        (trace
          ? ' | Trace: ' +
            (typeof trace === 'object' ? JSON.stringify(trace) : String(trace))
          : '');
      sessionLogs.push({
        time: new Date().toISOString(),
        level,
        message: logMsg,
      });
      if (level === 'log') this.logger.log(message);
      else if (level === 'warn') this.logger.warn(message);
      else if (level === 'error') this.logger.error(message, trace);
    };

    let totalScraped = 0;
    let statusCode = 200;
    let errorDump: string | null = null;

    addLog('log', `Scraper engine started for source: ${sourceSite}...`);
    const supabase = this.supabaseService.getClient();

    try {
      try {
        await this.mailerService.sendMail(
          `Scraping Started: ${sourceSite}`,
          `<p>The scraper engine has just started for <b>${sourceSite}</b> at ${startTime}.</p>`,
        );
      } catch (mailErr) {
        this.logger.error('Failed to send start email', mailErr);
      }

      // 1. Fetch dynamic config
      const { data: configData, error: configError } = await supabase
        .from('scraping_configs')
        .select('*')
        .eq('source_site', sourceSite)
        .eq('is_active', true)
        .single();

      if (configError || !configData) {
        addLog(
          'error',
          `Failed to fetch config for ${sourceSite}`,
          configError,
        );
        return { message: 'Config not found', error: configError };
      }

      const config = configData;

      // 2. Empty TMP table for this source site
      addLog('log', `Emptying products_tmp for ${sourceSite}...`);
      const { error: deleteError } = await supabase
        .from('products_tmp')
        .delete()
        .eq('source_site', sourceSite);

      if (deleteError) {
        addLog('error', 'Failed to empty products_tmp', deleteError);
        return { message: 'Failed to empty tmp table', error: deleteError };
      }

      const browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage', // <--- BU ÇOX VACİBDİR! (Docker-də RAM-ı qoruyur)
          '--no-zygote', // RAM-ı rahatladır
        ],
      });

      // totalScraped moved up

      const categories = config.categories || [];

      // Helper for concurrency limits
      const concurrencyLimit = 2;
      let activeWorkers = 0;
      const queue: (() => void)[] = [];
      const limit = async <T>(fn: () => Promise<T>): Promise<T> => {
        if (activeWorkers >= concurrencyLimit) {
          await new Promise<void>((resolve) => queue.push(resolve));
        }
        activeWorkers++;
        try {
          return await fn();
        } finally {
          activeWorkers--;
          if (queue.length > 0) {
            const next = queue.shift();
            if (next) next();
          }
        }
      };

      const processCategory = async (category: any) => {
        const page = await browser.newPage();

        // 1. Resource Interception (The "Blind Browser")
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          if (
            ['image', 'stylesheet', 'font', 'media'].includes(
              req.resourceType(),
            )
          ) {
            req.abort();
          } else {
            req.continue();
          }
        });

        const targetUrl = config.base_url + category.path;
        addLog('log', `[Worker] Sayta daxil olunur: ${targetUrl}`);

        try {
          await page.goto(targetUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
        } catch (e) {
          addLog('error', `[Worker] Failed to navigate to ${targetUrl}`, e);
          await page.close().catch(() => {});
          return 0;
        }

        try {
          addLog(
            'log',
            `[Worker] ${category.name} - Məhsulların DOM-da yaranması gözlənilir...`,
          );
          await page.waitForSelector(config.selectors.productCard, {
            timeout: 30000,
          });
          addLog(
            'log',
            `[Worker] ${category.name} - Məhsullar tapıldı, oxumağa başlayırıq!`,
          );
        } catch (e) {
          addLog(
            'warn',
            `[Worker] ${category.name} - 15 saniyə gözlənildi, amma məhsullar tapılmadı: ${targetUrl}`,
          );
          await page.close().catch(() => {});
          return 0;
        }

        let hasMore = true;
        let loopCounter = 1;
        let categoryScraped = 0;

        while (hasMore) {
          try {
            addLog(
              'log',
              `[Worker] Kategoriya: ${category.name} | Döngü ${loopCounter} başladı. DOM oxunur...`,
            );

            // Send config to Puppeteer context
            const extractedProducts = await page.evaluate((evalConfig) => {
              const results: any[] = [];
              const productCards = document.querySelectorAll(
                evalConfig.selectors.productCard,
              );

              productCards.forEach((card) => {
                const colorInputs = card.querySelectorAll(
                  evalConfig.selectors.colorInputs,
                );
                const priceEl = card.querySelector(
                  evalConfig.selectors.priceCurrent,
                ) as HTMLElement;
                const oldPriceEl = card.querySelector(
                  evalConfig.selectors.priceOld,
                ) as HTMLElement;
                const labelEl = card.querySelector(
                  evalConfig.selectors.label,
                ) as HTMLElement;

                const currentPrice = priceEl
                  ? parseFloat(priceEl.innerText.replace(/[^0-9.]/g, ''))
                  : 0;
                const oldPrice = oldPriceEl
                  ? parseFloat(oldPriceEl.innerText.replace(/[^0-9.]/g, ''))
                  : null;

                let inStock = true;
                if (labelEl) {
                  const labelText = labelEl.innerText.trim().toLowerCase();
                  const keywordsArray = evalConfig.out_of_stock_keywords || [];
                  const isOutOfStock = keywordsArray.some((keyword: string) =>
                    labelText.includes(keyword),
                  );
                  if (isOutOfStock) {
                    inStock = false;
                  }
                }

                if (colorInputs && colorInputs.length > 0) {
                  colorInputs.forEach((input: Element) => {
                    results.push({
                      title: input.getAttribute(
                        evalConfig.attributes.colorTitle,
                      ),
                      product_url: input.getAttribute(
                        evalConfig.attributes.colorUrl,
                      ),
                      main_image_url: input.getAttribute(
                        evalConfig.attributes.colorImage,
                      ),
                      price_current: currentPrice,
                      price_old: oldPrice,
                      is_in_stock: inStock,
                      has_colors: true,
                      parent_title:
                        card
                          .querySelector(evalConfig.selectors.parentTitle)
                          ?.textContent?.trim() || 'Məhsul',
                    });
                  });
                } else {
                  const defaultLink = card.querySelector(
                    evalConfig.selectors.defaultLink,
                  ) as HTMLAnchorElement;
                  const defaultImg = card.querySelector(
                    evalConfig.selectors.defaultImage,
                  ) as HTMLImageElement;

                  results.push({
                    title: defaultLink
                      ? defaultLink.innerText.trim()
                      : 'Ad tapılmadı',
                    product_url: defaultLink ? defaultLink.href : '',
                    main_image_url: defaultImg ? defaultImg.src : '',
                    price_current: currentPrice,
                    price_old: oldPrice,
                    is_in_stock: inStock,
                    has_colors: false,
                  });
                }

                card.remove();
              });

              return results;
            }, config);

            categoryScraped += extractedProducts.length;
            addLog(
              'log',
              `[Worker] Kategoriya: ${category.name} | Bu döngüdə ${extractedProducts.length} məhsul tapıldı.`,
            );

            if (extractedProducts.length > 0) {
              const mappedData = extractedProducts.map((p) => ({
                product_url: p.product_url,
                title: p.title,
                main_image_url: p.main_image_url,
                price_current: p.price_current,
                price_old: p.price_old,
                is_in_stock: p.is_in_stock,
                source_site: sourceSite,
                category_path: category.name,
              }));

              addLog(
                'log',
                `[Worker] ${category.name} - Supabase products_tmp-ə ${mappedData.length} məhsul əlavə edilir...`,
              );
              const { error: upsertError } = await supabase
                .from('products_tmp')
                .upsert(mappedData, { onConflict: 'product_url' });
              if (upsertError) {
                addLog(
                  'error',
                  `[Worker] ${category.name} - Supabase yazılmasında xəta:`,
                  upsertError,
                );
              } else {
                addLog(
                  'log',
                  `[Worker] ${category.name} - Batch uğurla Supabase-ə yazıldı.`,
                );
              }
            }

            try {
              const loadMoreBtn = await page.$(config.selectors.loadMoreBtn);
              if (loadMoreBtn) {
                // Check visibility. Use offsetParent as a more robust check when CSS might be blocked.
                const isVisible = await page.evaluate((el) => {
                  if (!el) return false;
                  const style = window.getComputedStyle(el);
                  return (
                    style.display !== 'none' &&
                    style.visibility !== 'hidden' &&
                    style.opacity !== '0' &&
                    (el as HTMLElement).offsetParent !== null
                  );
                }, loadMoreBtn);

                if (isVisible) {
                  addLog(
                    'log',
                    `[Worker] ${category.name} - Daha çox yüklə düyməsi basılır. Səhifənin yüklənməsi gözlənilir...`,
                  );

                  // Click via evaluate to avoid Puppeteer scrolling/hanging issues if the element is covered or detached
                  await page.evaluate(
                    (el) => (el as HTMLElement).click(),
                    loadMoreBtn,
                  );

                  // 3. Smart Wait (DOM Mutation Polling)
                  // Because we removed all `.product` elements in the previous step,
                  // we can simply wait for new ones to appear in the DOM!
                  try {
                    await page.waitForSelector(config.selectors.productCard, {
                      timeout: 10000,
                    });
                    // Small artificial delay to allow the rest of the batch to finish rendering
                    await new Promise((resolve) => setTimeout(resolve, 2000));

                    loopCounter++;
                  } catch (waitError) {
                    addLog(
                      'warn',
                      `[Worker] ${category.name} - Yeni məhsullar yüklənmədi (Timeout). Kategoriya ola bilsin ki bitib.`,
                    );
                    hasMore = false;
                  }
                } else {
                  addLog(
                    'log',
                    `[Worker] ${category.name} - Daha çox yüklə düyməsi görünmür. Pagination bitdi.`,
                  );
                  hasMore = false;
                }
              } else {
                addLog(
                  'log',
                  `[Worker] ${category.name} - Daha çox yüklə düyməsi tapılmadı. Pagination bitdi.`,
                );
                hasMore = false;
              }
            } catch (err) {
              addLog(
                'warn',
                `[Worker] ${category.name} - Sonrakı səhifəyə keçərkən xəta:`,
                err,
              );
              hasMore = false;
            }
          } catch (loopError) {
            addLog(
              'error',
              `[Worker] Kategoriya ${category.name} üçün loop xətası:`,
              loopError,
            );
            hasMore = false;
          }
        }

        await page.close().catch(() => {});
        return categoryScraped;
      };

      // Run workers concurrently
      const promises = categories.map((category: any) =>
        limit(() => processCategory(category)),
      );
      const results = await Promise.all(promises);

      totalScraped = results.reduce((acc, curr) => acc + curr, 0);

      await browser.close();
      addLog(
        'log',
        `Proses uğurla bitdi! Çəkilən ümumi məhsul sayı: ${totalScraped}`,
      );

      // 4. Final Sync
      await this.syncDatabase(sourceSite);
    } catch (err: any) {
      statusCode = 500;
      errorDump =
        err instanceof Error ? (err.stack ?? err.message) : JSON.stringify(err);
      addLog('error', 'Fatal error during scraping session', err);

      try {
        await this.mailerService.sendMail(
          `CRITICAL: Scraper Failed for ${sourceSite}`,
          `<h2>Scraper Failed</h2>
           <p><strong>Source:</strong> ${sourceSite}</p>
           <p><strong>Error:</strong> ${err.message || String(err)}</p>
           <h3>Stack Trace:</h3>
           <pre>${errorDump}</pre>`,
        );
      } catch (mailErr) {
        this.logger.error('Failed to send error email', mailErr);
      }
    } finally {
      if (statusCode === 200) {
        try {
          await this.mailerService.sendMail(
            `Success: Scraper Finished for ${sourceSite}`,
            `<h2>Scraping Successful!</h2>
             <p><strong>Source:</strong> ${sourceSite}</p>
             <p><strong>Total Products Scraped:</strong> ${totalScraped}</p>
             <p><strong>Time:</strong> ${new Date().toISOString()}</p>`,
          );
        } catch (mailErr) {
          this.logger.error('Failed to send success email', mailErr);
        }
      }

      try {
        addLog('log', 'Saving session logs to Supabase...');
        const { error: logInsertError } = await supabase
          .from('scraping_logs')
          .insert({
            start_time: startTime,
            end_time: new Date().toISOString(),
            status_code: statusCode,
            error_dump: errorDump,
            log_message: JSON.stringify(sessionLogs),
            target_site: sourceSite,
          });
        if (logInsertError) {
          this.logger.error(
            'Failed to save scraping logs to Supabase',
            logInsertError,
          );
        }
      } catch (logErr) {
        this.logger.error('Critical failure while saving logs', logErr);
      }
    }

    return {
      message: statusCode === 200 ? 'Scraping finished' : 'Scraping failed',
      total_items: typeof totalScraped !== 'undefined' ? totalScraped : 0,
    };
  }

  async syncDatabase(sourceSite: string): Promise<void> {
    this.logger.log(`Starting DB sync for ${sourceSite} via RPC...`);
    const { error } = await this.supabaseService
      .getClient()
      .rpc('sync_products', { p_source_site: sourceSite });

    if (error) {
      this.logger.error(`Sync failed for ${sourceSite}`, error);
    } else {
      this.logger.log(`Sync completed successfully for ${sourceSite}!`);
    }
  }
}
