export type GreetingMoment = {
  greeting: "Good morning" | "Good afternoon" | "Good evening" | "Good night";
  note: string;
  symbol: string;
};

export function greetingFor(date = new Date()): GreetingMoment {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return { greeting: "Good morning", note: "Fresh signals, clear decisions.", symbol: "☀" };
  if (hour >= 12 && hour < 17) return { greeting: "Good afternoon", note: "Your intelligence desk is in full swing.", symbol: "◐" };
  if (hour >= 17 && hour < 22) return { greeting: "Good evening", note: "Let’s close the signal loop.", symbol: "◒" };
  return { greeting: "Good night", note: "Quiet hours, important signals.", symbol: "☾" };
}
