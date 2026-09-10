import type { MetadataRoute } from 'next';

const BASE_URL = 'https://data.xoompark.co';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL, changeFrequency: 'weekly', priority: 1 },
  ];
}
