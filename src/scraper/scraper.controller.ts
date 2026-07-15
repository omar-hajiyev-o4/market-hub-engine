import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScraperService } from './scraper.service';

@ApiTags('Scraper')
@Controller('api')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('scraper/run')
  @ApiOperation({ summary: 'Run the scraper engine manually' })
  async runScraper() {
    await this.scraperService.websiteScrapingMain();
    return { message: 'Scraper engine started successfully' };
  }

  @Post('stop')
  @ApiOperation({ summary: 'Abort the currently running scraper' })
  abortScraper() {
    return this.scraperService.abortScraping();
  }
}
