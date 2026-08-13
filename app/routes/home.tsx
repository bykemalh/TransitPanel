import { Welcome } from "../welcome/welcome";

export function meta() {
  return [
    { title: "TransitPanel" },
    { name: "description", content: "TransitPanel GTFS & PostGIS Admin" },
  ];
}

export default function Home() {
  return <Welcome />;
}
