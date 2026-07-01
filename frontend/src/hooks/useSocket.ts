import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import type {
  ActiveUser, ChatMessage, BattleMapSessionData, BattleMapPosition,
  Location, PendingRequest,
} from '../types';

interface UseSocketOptions {
  userName: string;
  token: string;
  playerToken?: string | null;
  isLoggedIn: boolean;
  notificationsEnabled: boolean;
  isChatOpen: boolean;
  onFetchAll: () => void;
  onFetchGlobalSettings?: () => void;
  onFetchLocations: () => void;
  onFetchRoads: () => void;
  onFetchDistricts: () => void;
  onFetchWaterBodies: () => void;
  onFetchBattleMaps?: () => void;
  onBankUpdate: (balance: number, debt: number, firstPayDone?: boolean) => void;
  onBalancePaid?: (balance: number, debt: number, firstPayDone?: boolean) => void;
  onNotification: (msg: string | null) => void;
  onHasUnreadChat: (val: boolean) => void;
  onTokenUpdate: (token: string) => void;
  onIsAdminUpdate: (isAdmin: boolean) => void;
  onRegistrationPending?: (username: string) => void;
  onRegistrationUpdated?: (username: string, action: 'approved' | 'denied') => void;
}

export function useSocket({
  userName, token, playerToken, isLoggedIn, notificationsEnabled, isChatOpen,
  onFetchAll, onFetchGlobalSettings, onFetchLocations, onFetchRoads, onFetchDistricts, onFetchWaterBodies, onFetchBattleMaps,
  onBankUpdate, onBalancePaid, onNotification, onHasUnreadChat, onTokenUpdate, onIsAdminUpdate,
  onRegistrationPending, onRegistrationUpdated,
}: UseSocketOptions) {
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const tokenRef = useRef(token);
  const playerTokenRef = useRef(playerToken);
  const userNameRef = useRef(userName);
  const isChatOpenRef = useRef(isChatOpen);
  const notificationsEnabledRef = useRef(notificationsEnabled);
  const wasGrantedForEditRef = useRef(false);

  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activePings, setActivePings] = useState<{ id: string; x: number; y: number; z: number; color: string; owner?: string; battle_map_id?: number | null; floor_index?: number | null; size?: number }[]>([]);
  const [battleMapPositions, setBattleMapPositions] = useState<Record<string, BattleMapPosition>>({});
  const [activeBattleMapData, setActiveBattleMapData] = useState<BattleMapSessionData | null>(null);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [isSomeoneEditing, setIsSomeoneEditing] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [activeEditLocation, setActiveEditLocation] = useState<Location | null>(null);

  // Keep refs in sync for use inside stable socket callbacks
  useEffect(() => { tokenRef.current = token; }, [token]);
  useEffect(() => { playerTokenRef.current = playerToken; }, [playerToken]);
  useEffect(() => { userNameRef.current = userName; }, [userName]);
  useEffect(() => { isChatOpenRef.current = isChatOpen; }, [isChatOpen]);
  useEffect(() => { notificationsEnabledRef.current = notificationsEnabled; }, [notificationsEnabled]);

  useEffect(() => {
    if (!isLoggedIn) return;

    const newSocket = io();
    socketRef.current = newSocket;

    newSocket.on('connect', () => {
      newSocket.emit('identify', { userName: userNameRef.current, isAdmin: !!tokenRef.current, token: tokenRef.current, playerToken: playerTokenRef.current });
    });

    newSocket.on('authError', (data: { message: string }) => {
      onNotification(data.message || 'SESSION_INVALID // PLEASE_LOG_IN_AGAIN');
    });

    newSocket.on('settingsUpdated', () => {
      onFetchGlobalSettings?.();
    });

    newSocket.on('dataUpdated', (payload: { isRhombusOnly?: boolean }) => {
      onFetchLocations();
      onFetchRoads();
      onFetchDistricts();
      onFetchWaterBodies();
      if (!payload?.isRhombusOnly) {
        (window as any).hasUnsavedChanges = true;
        onFetchBattleMaps?.();
      }
    });

    newSocket.on('activeUsersUpdated', (users: ActiveUser[]) => setActiveUsers(users));

    newSocket.on('chatHistory', (history: ChatMessage[]) => setChatMessages(history));

    newSocket.on('receiveMessage', (msg: ChatMessage) => {
      setChatMessages(prev => [...prev, msg]);
      if (!isChatOpenRef.current && notificationsEnabledRef.current && msg.sender !== userNameRef.current) {
        onHasUnreadChat(true);
      }
    });

    newSocket.on('receivePrivateMessage', (msg: { sender: string }) => {
      if (!isChatOpenRef.current && notificationsEnabledRef.current && msg.sender !== userNameRef.current) {
        onHasUnreadChat(true);
      }
    });

    let lastKnownBalance: number | null = null;
    newSocket.on('bankUpdate', (data: { username: string; balance: number; debt: number; firstPayDone?: boolean }) => {
      if (data.username !== userNameRef.current) return;
      onBankUpdate(data.balance, data.debt, data.firstPayDone);
      if (lastKnownBalance !== null && data.balance > lastKnownBalance) {
        onBalancePaid?.(data.balance, data.debt, data.firstPayDone);
      }
      lastKnownBalance = data.balance;
    });
    newSocket.emit('requestBankBalance', { username: userName });

    newSocket.on('accessGranted', (data: { targetUser: string; token: string; forEditing?: boolean }) => {
      if (data.targetUser === userNameRef.current) {
        tokenRef.current = data.token;
        onTokenUpdate(data.token);
        onIsAdminUpdate(true);
        if (data.forEditing) {
          wasGrantedForEditRef.current = true;
          onNotification(null);
        } else {
          onNotification('TEMPORARY_ADMIN_ACCESS_GRANTED');
        }
      }
    });

    newSocket.on('accessRevoked', (data: { targetUser: string }) => {
      if (data.targetUser === userNameRef.current) {
        tokenRef.current = '';
        onTokenUpdate('');
        onIsAdminUpdate(false);
        onNotification('TEMPORARY_ADMIN_ACCESS_REVOKED');
      }
    });

    newSocket.on('registrationPending', (data: { username: string }) => {
      onRegistrationPending?.(data.username);
    });

    newSocket.on('registrationUpdated', (data: { username: string; action: 'approved' | 'denied' }) => {
      onRegistrationUpdated?.(data.username, data.action);
    });

    newSocket.on('force_floor_change', (data: { locationId: number; floorIndex: number }) => {
      setActiveBattleMapData(prev =>
        prev && prev.locationId === data.locationId
          ? { ...prev, currentFloorIndex: data.floorIndex }
          : prev
      );
    });

    newSocket.on('battle_map_moved', (data: { userName: string; x: number; z: number }) => {
      setBattleMapPositions(prev => ({ ...prev, [data.userName]: { x: data.x, z: data.z } }));
    });

    newSocket.on('default_loaded', (data: { updates: { userName?: string; x: number; z: number; isEnemy: boolean; isFriendly: boolean }[] }) => {
      data.updates.forEach(update => {
        if (!update.isEnemy && !update.isFriendly && update.userName) {
          setBattleMapPositions(prev => ({ ...prev, [update.userName!]: { x: update.x, z: update.z } }));
        }
      });
    });

    newSocket.on('editingRequested', (data: PendingRequest & { userName?: string }) => {
      setPendingRequests(prev => [...prev, data]);
    });

    newSocket.on('editingStarted', (data: { userId: string; location: Location }) => {
      setIsSomeoneEditing(true);
      if (data.userId === userNameRef.current) {
        setActiveEditLocation(data.location);
        setIsEditModalOpen(true);
      }
    });

    newSocket.on('editingStopped', () => setIsSomeoneEditing(false));

    newSocket.on('editingDenied', (data: { userId: string }) => {
      if (data.userId === userNameRef.current) onNotification('EDITING_ACCESS_DENIED_BY_ADMIN');
    });

    newSocket.on('editingRevoked', (data: { userId: string }) => {
      setIsEditModalOpen(false);
      setActiveEditLocation(null);
      setIsSomeoneEditing(false);
      if (data.userId === userNameRef.current) onNotification('ACCESS_TO_DATA_POINT_REVOKED');
    });

    newSocket.on('location_pinged', (pingData: { owner?: string; x: number; y: number; z: number; color: string }) => {
      const pingId = Math.random().toString(36).substr(2, 9);
      setActivePings(prev => {
        const filtered = pingData.owner ? prev.filter(p => p.owner !== pingData.owner) : prev;
        return [...filtered, { ...pingData, id: pingId }];
      });
      setTimeout(() => setActivePings(prev => prev.filter(p => p.id !== pingId)), 4000);
    });

    return () => { newSocket.disconnect(); };
  }, [userName, isLoggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-identify when token changes (updates roster rank, e.g. after access grant/revoke).
  // Only fires on an already-connected socket so we don't buffer a tokenless identify
  // that would trip SECURE_MODE on initial connect (the connect handler covers that case).
  useEffect(() => {
    if (socketRef.current?.connected && userName) {
      socketRef.current.emit('identify', { userName, isAdmin: !!token, token, playerToken: playerTokenRef.current });
    }
  }, [token, userName]);

  const emit = useCallback((event: string, data?: unknown) => {
    socketRef.current?.emit(event, data);
  }, []);

  return {
    socket: socketRef.current,
    socketRef,
    tokenRef,
    userNameRef,
    wasGrantedForEditRef,
    activeUsers,
    chatMessages, setChatMessages,
    activePings,
    battleMapPositions, setBattleMapPositions,
    activeBattleMapData, setActiveBattleMapData,
    pendingRequests, setPendingRequests,
    isSomeoneEditing, setIsSomeoneEditing,
    isEditModalOpen, setIsEditModalOpen,
    activeEditLocation, setActiveEditLocation,
    emit,
  };
}
