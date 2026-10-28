import './globals.css';
import Header from '../components/Header';
import Walkthrough from '../components/Walkthrough';
export const metadata = { title: 'Verity — Brand Governance', description: 'Every word. Every pixel. On brand.' };
export const viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a saved light or dark choice before the first paint, so the page never flashes the other theme. */}
        <script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('verity_theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}" }} />
      </head>
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <a href="#main" className="skip">Skip to content</a>
        <Header />
        <main id="main">{children}</main>
        <Walkthrough />
      </body>
    </html>
  );
}
