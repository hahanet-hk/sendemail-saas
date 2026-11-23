'use client';
import AuthView from '../authView';
export default function R() { return <AuthView onSuccess={() => { window.location.href = '/'; }} />; }
