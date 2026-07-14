export class CreateProductTmpDto {
  id?: string;
  created_at?: string;
  product_url: string;
  title: string;
  price_current: number;
  price_old?: number;
  main_image_url?: string;
  is_in_stock: boolean;
  fk_log_id: string;
}
