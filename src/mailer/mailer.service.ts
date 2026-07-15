import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private transporter: any;

  private EMAIL_USER = process.env.EMAIL_USER as string;
  private EMAIL_PASSWORD = process.env.EMAIL_PASSWORD as string;
  private EMAIL_TO = process.env.EMAIL_TO as string;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: this.EMAIL_USER,
        pass: this.EMAIL_PASSWORD,
      },
    });
  }

  async sendMail(subject: string, html: string): Promise<void> {
    const to = this.EMAIL_TO;
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
      this.logger.warn(
        `Skipping email to ${to}: EMAIL_USER or EMAIL_PASSWORD is missing in .env`,
      );
      return;
    }

    try {
      this.logger.log(`Sending email to ${to} with subject: "${subject}"`);
      await this.transporter.sendMail({
        from: `"Market Hub Engine" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
      });
      this.logger.log(`Email successfully sent to ${to}`);
    } catch (error: any) {
      this.logger.error(
        `SMTP Error: Failed to send email to ${to}. If using Gmail, ensure you are using an "App Password" rather than your main password!`,
      );
      this.logger.error(`Details: ${error.message}`);
    }
  }
}
