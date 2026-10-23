import { mount } from "svelte";
import SharePage from "./components/SharePage.svelte";
import "./app.css";

const target = document.getElementById("app");
if (target) mount(SharePage, { target });
