import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/contexts/AuthContext';
import { Toaster } from 'sonner';
import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

const SITE_NAME = 'XoomPark';
const SITE_DESCRIPTION =
  'A distributed network of small, staffed service bays for AV fleets. Charging, cleaning, and minor service right where your vehicles already drive. Pay per vehicle, not per visit.';

export const metadata: Metadata = {
  metadataBase: new URL('https://xoompark.co'),
  title: {
    default: `${SITE_NAME} | Pit Stops for Autonomous Vehicles`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: SITE_NAME,
    type: 'website',
    locale: 'en_US',
    title: `${SITE_NAME} | Pit Stops for Autonomous Vehicles`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: `${SITE_NAME} | Pit Stops for Autonomous Vehicles`,
    description: SITE_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#f0f5ff',
  colorScheme: 'light',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-[#fdfcfc] text-[#171717]">
        <AuthProvider>
          {children}
          <Toaster richColors position="top-right" />
        </AuthProvider>
      </body>
    </html>
  );
}
