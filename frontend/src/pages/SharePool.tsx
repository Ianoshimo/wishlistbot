import { useParams } from "react-router-dom";
import { Placeholder } from "../components/UI";

export function SharePool() {
  const { id = "" } = useParams();
  return <Placeholder title="Поделиться" backTo={`/p/${id}`} />;
}
