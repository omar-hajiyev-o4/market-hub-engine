import { Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScraperService } from './scraper.service';

@ApiTags('Scraper')
@Controller('scraper')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}

  @Post('run')
  @ApiOperation({ summary: 'Run the Irshad scraper' })
  async runScraper() {
    await this.scraperService.websiteScrapingMain();
    return { message: 'Scraper engine started successfully' };
  }

  @Post('abort')
  @ApiOperation({ summary: 'Abort the currently running scraper' })
  abortScraper() {
    return this.scraperService.abortScraping();
  }
}
