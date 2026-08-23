import Hero from '@/components/Hero';
import WhyChooseUs from '@/components/WhyChooseUs';
import Packages from '@/components/Packages';
import Testimonials from '@/components/Testimonials';
import About from '@/components/About';
import Contact from '@/components/Contact';
import Location from '@/components/Location';
import JourneyTimeline from '@/components/JourneyTimeline';
import DepartureCountdown from '@/components/DepartureCountdown';
import FAQ from '@/components/FAQ';

export default function HomePage() {
  return (
    <main>
      <Hero />
      <WhyChooseUs />
      <Packages />
      <DepartureCountdown />
      <JourneyTimeline />
      <Testimonials />
      <About />
      <FAQ />
      <Location />
      <Contact />
    </main>
  );
}
